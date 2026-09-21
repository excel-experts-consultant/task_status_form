/**
 * FieldOps API — Cloudflare Pages Functions (no build step, no dependencies).
 * Every route below lives under /api/...
 *
 * Bindings expected (see wrangler.toml / Pages dashboard):
 *   DB                      D1 database
 *   SESSION_SECRET          secret, any long random string
 *   GOOGLE_SERVICE_ACCOUNT  secret, the full service-account JSON as one line
 *   SHEET_ID                var, the spreadsheet id
 *   SHEET_TAB               var, default "TNK FD"
 *   DIESEL_RANGE            var, fallback diesel-left cell e.g. 'TNK FD'!K2
 *   NIGHT_START / NIGHT_END vars, hours (local) when muting is allowed, e.g. 21 and 6
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const fail = (message, status = 400) => json({ ok: false, error: message }, status);

/* ------------------------------------------------------------------ crypto */

const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(password, saltHex, iterations = 100000) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return hex(bits);
}

export async function hashPassword(password) {
  const saltHex = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$100000$${saltHex}$${await pbkdf2(password, saltHex)}`;
}

async function verifyPassword(password, stored) {
  const [scheme, iters, saltHex, digest] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const check = await pbkdf2(password, saltHex, Number(iters));
  // constant-time-ish compare
  if (check.length !== digest.length) return false;
  let diff = 0;
  for (let i = 0; i < check.length; i++) diff |= check.charCodeAt(i) ^ digest.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

async function signToken(env, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(env.SESSION_SECRET, body)}`;
}

async function readToken(env, token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if ((await hmac(env.SESSION_SECRET, body)) !== sig) return null;
  try {
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

async function requireUser(request, env, role) {
  const header = request.headers.get('authorization') || '';
  const session = await readToken(env, header.replace(/^Bearer\s+/i, ''));
  if (!session) return null;
  if (role && session.role !== role) return null;
  const user = await env.DB.prepare('SELECT id, username, name, role, active, mute_until FROM users WHERE id = ?')
    .bind(session.uid).first();
  return user && user.active ? user : null;
}

/* ----------------------------------------------------------- google sheets */

let tokenCache = { value: null, exp: 0 };

function pemToBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function googleToken(env) {
  if (tokenCache.value && tokenCache.exp > Date.now() + 60000) return tokenCache.value;
  if (!env.GOOGLE_SERVICE_ACCOUNT) throw new Error('GOOGLE_SERVICE_ACCOUNT is not configured');
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })));
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claim}`)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google auth failed: ${data.error_description || data.error || res.status}`);
  tokenCache = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

const sheetsUrl = (env, path) =>
  `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}${path}`;

async function readRange(env, range) {
  const token = await googleToken(env);
  const res = await fetch(sheetsUrl(env, `/values/${encodeURIComponent(range)}`), {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Sheets read failed (${res.status})`);
  return data.values?.[0]?.[0] ?? '';
}

/**
 * Append one row to the TNK FD sheet.
 *   Column A  index 0  Date time
 *   Column F  index 5  DG hours reading
 *   Column I  index 8  Tanker reading
 * Column B is filled with the site name so rows are traceable; blank the rest.
 */
async function appendReading(env, tab, { dateTime, siteName, dgHours, tankerReading }) {
  const token = await googleToken(env);
  const row = ['', '', '', '', '', '', '', '', ''];
  row[0] = dateTime;
  row[1] = siteName;
  row[5] = dgHours;
  row[8] = tankerReading;
  const range = `${tab}!A:I`;
  const res = await fetch(
    sheetsUrl(env, `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`),
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, ...JSON_HEADERS },
      body: JSON.stringify({ values: [row] }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Sheets append failed (${res.status})`);
  return data.updates?.updatedRange || '';
}

/* ------------------------------------------------------------------ helpers */

const nowIso = () => new Date().toISOString();

/** Milliseconds to add to a UTC instant to get the wall clock in `tz`. */
function tzOffset(tz, date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - date.getTime();
}

/** The next time it is `hour`:00 in `tz`, returned as a real UTC instant. */
function nextLocalHour(tz, hour) {
  const now = new Date();
  const offset = tzOffset(tz, now);
  const wall = new Date(now.getTime() + offset);
  wall.setUTCHours(hour, 0, 0, 0);
  if (wall.getTime() <= now.getTime() + offset) wall.setUTCDate(wall.getUTCDate() + 1);
  return new Date(wall.getTime() - offset);
}

function stamp(tz = 'Asia/Kolkata') {
  // "2026-09-16 14:05:00" in the operating timezone, for column A
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, p) => (a[p.type] = p.value, a), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/* ------------------------------------------------------------------- routes */

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = '/' + (Array.isArray(params.path) ? params.path.join('/') : params.path || '');
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      },
    });
  }

  const body = method === 'GET' ? {} : await request.json().catch(() => ({}));
  const url = new URL(request.url);

  try {
    const res = await route({ path, method, body, url, request, env });
    // allow the Capacitor app (origin capacitor://localhost) to call the API
    res.headers.set('access-control-allow-origin', '*');
    return res;
  } catch (err) {
    return fail(err.message || 'Unexpected server error', 500);
  }
}

async function route({ path, method, body, url, request, env }) {
  /* ---------- auth ---------- */

  if (path === '/auth/login' && method === 'POST') {
    const username = String(body.username || '').trim().toLowerCase();
    const user = await env.DB.prepare(
      'SELECT id, username, name, role, password_hash, active FROM users WHERE lower(username) = ?',
    ).bind(username).first();
    if (!user || !user.active || !(await verifyPassword(String(body.password || ''), user.password_hash))) {
      return fail('Username or password is wrong', 401);
    }
    const token = await signToken(env, {
      uid: user.id, role: user.role, exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
    });
    return json({ ok: true, token, user: { id: user.id, name: user.name, role: user.role, username: user.username } });
  }

  if (path === '/auth/me' && method === 'GET') {
    const user = await requireUser(request, env);
    return user ? json({ ok: true, user }) : fail('Session expired', 401);
  }

  if (path === '/auth/password' && method === 'POST') {
    const user = await requireUser(request, env);
    if (!user) return fail('Session expired', 401);
    if (String(body.password || '').length < 6) return fail('Use at least 6 characters', 400);
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(body.password), user.id).run();
    return json({ ok: true });
  }

  /* ---------- admin ---------- */

  if (path.startsWith('/admin/')) {
    const admin = await requireUser(request, env, 'admin');
    if (!admin) return fail('Admin sign-in required', 401);

    if (path === '/admin/bootstrap' && method === 'GET') {
      const [tasks, employees, sites] = await Promise.all([
        env.DB.prepare('SELECT id, key, name FROM tasks WHERE active = 1 ORDER BY name').all(),
        env.DB.prepare("SELECT id, name, username FROM users WHERE role = 'employee' AND active = 1 ORDER BY name").all(),
        env.DB.prepare('SELECT id, code, name, region FROM sites WHERE active = 1 ORDER BY name').all(),
      ]);
      return json({
        ok: true, admin: { id: admin.id, name: admin.name },
        tasks: tasks.results, employees: employees.results, sites: sites.results,
      });
    }

    if (path === '/admin/stats' && method === 'GET') {
      const stats = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM sites WHERE active = 1) AS sites,
          (SELECT COUNT(*) FROM users WHERE role = 'employee' AND active = 1) AS employees,
          (SELECT COUNT(*) FROM assignment_sites s JOIN assignments a ON a.id = s.assignment_id
             WHERE s.status = 'pending' AND a.status = 'open') AS pending,
          (SELECT COUNT(*) FROM submissions WHERE date(submitted_at) = date('now')) AS today,
          (SELECT COUNT(*) FROM submissions WHERE sheet_status != 'synced') AS unsynced
      `).first();
      return json({ ok: true, stats });
    }

    // Allocate one task to many employees across many sites.
    if (path === '/admin/allocate' && method === 'POST') {
      const taskId = Number(body.task_id);
      const employeeIds = [...new Set((body.employee_ids || []).map(Number).filter(Boolean))];
      const siteIds = [...new Set((body.site_ids || []).map(Number).filter(Boolean))];
      if (!taskId) return fail('Pick a task');
      if (!employeeIds.length) return fail('Pick at least one employee');
      if (!siteIds.length) return fail('Tick at least one site');

      const statements = [];
      const created = [];
      for (const employeeId of employeeIds) {
        const row = await env.DB.prepare(
          'INSERT INTO assignments (task_id, employee_id, assigned_by, due_date, notes) VALUES (?, ?, ?, ?, ?) RETURNING id',
        ).bind(taskId, employeeId, admin.id, body.due_date || null, body.notes || null).first();
        created.push(row.id);
        for (const siteId of siteIds) {
          statements.push(
            env.DB.prepare('INSERT OR IGNORE INTO assignment_sites (assignment_id, site_id) VALUES (?, ?)')
              .bind(row.id, siteId),
          );
        }
      }
      if (statements.length) await env.DB.batch(statements);
      return json({ ok: true, assignments: created.length, jobs: created.length * siteIds.length });
    }

    if (path === '/admin/assignments' && method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT a.id, a.due_date, a.notes, a.status, a.created_at,
               t.name AS task_name, u.name AS employee_name, ab.name AS assigned_by,
               COUNT(s.id) AS total,
               SUM(CASE WHEN s.status = 'done' THEN 1 ELSE 0 END) AS done
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        JOIN users u ON u.id = a.employee_id
        JOIN users ab ON ab.id = a.assigned_by
        LEFT JOIN assignment_sites s ON s.assignment_id = a.id
        WHERE a.status != 'cancelled'
        GROUP BY a.id ORDER BY a.created_at DESC LIMIT 200
      `).all();
      return json({ ok: true, assignments: results });
    }

    if (path.startsWith('/admin/assignments/') && method === 'DELETE') {
      const id = Number(path.split('/').pop());
      await env.DB.prepare("UPDATE assignments SET status = 'cancelled' WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    if (path === '/admin/submissions' && method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT sub.id, sub.reading_date, sub.tanker_reading, sub.dg_hours, sub.diesel_left,
               sub.sheet_status, sub.sheet_error, sub.submitted_at,
               u.name AS employee_name, si.name AS site_name
        FROM submissions sub
        JOIN users u ON u.id = sub.employee_id
        JOIN sites si ON si.id = sub.site_id
        ORDER BY sub.submitted_at DESC LIMIT 300
      `).all();
      return json({ ok: true, submissions: results });
    }

    // Retry any rows that failed to reach the spreadsheet.
    if (path === '/admin/resync' && method === 'POST') {
      const { results } = await env.DB.prepare(`
        SELECT sub.*, si.name AS site_name, si.sheet_tab
        FROM submissions sub JOIN sites si ON si.id = sub.site_id
        WHERE sub.sheet_status != 'synced' LIMIT 50
      `).all();
      let synced = 0;
      for (const row of results) {
        try {
          const range = await appendReading(env, row.sheet_tab || env.SHEET_TAB || 'TNK FD', {
            dateTime: `${row.reading_date} ${row.submitted_at.slice(11, 19)}`,
            siteName: row.site_name, dgHours: row.dg_hours, tankerReading: row.tanker_reading,
          });
          await env.DB.prepare("UPDATE submissions SET sheet_status='synced', sheet_row=?, sheet_error=NULL WHERE id=?")
            .bind(range, row.id).run();
          synced++;
        } catch (err) {
          await env.DB.prepare('UPDATE submissions SET sheet_error = ? WHERE id = ?').bind(err.message, row.id).run();
        }
      }
      return json({ ok: true, synced, remaining: results.length - synced });
    }

    /* sites */
    if (path === '/admin/sites/import' && method === 'POST') {
      // Paste CSV/TSV from the Google Sheet: name, code, region, diesel_cell
      const lines = String(body.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const statements = [];
      for (const line of lines) {
        const [name, code, region, cell] = line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
          .map((v) => (v || '').trim().replace(/^"|"$/g, ''));
        if (!name || /^site\s*name$/i.test(name)) continue;
        statements.push(env.DB.prepare(`
          INSERT INTO sites (name, code, region, diesel_cell) VALUES (?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET
            code = COALESCE(excluded.code, sites.code),
            region = COALESCE(excluded.region, sites.region),
            diesel_cell = COALESCE(excluded.diesel_cell, sites.diesel_cell),
            active = 1
        `).bind(name, code || null, region || null, cell || null));
      }
      if (statements.length) await env.DB.batch(statements);
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM sites WHERE active = 1').first();
      return json({ ok: true, imported: statements.length, total: count.n });
    }

    /* employees */
    if (path === '/admin/employees' && method === 'GET') {
      const { results } = await env.DB.prepare(
        "SELECT id, name, username, phone, active, mute_until FROM users WHERE role = 'employee' ORDER BY name",
      ).all();
      return json({ ok: true, employees: results });
    }

    if (path === '/admin/employees' && method === 'POST') {
      const username = String(body.username || '').trim().toLowerCase();
      if (!username || !body.name) return fail('Name and username are both needed');
      if (String(body.password || '').length < 6) return fail('Password needs at least 6 characters');
      const exists = await env.DB.prepare('SELECT id FROM users WHERE lower(username) = ?').bind(username).first();
      if (exists) return fail('That username is already taken');
      await env.DB.prepare(
        "INSERT INTO users (username, password_hash, role, name, phone) VALUES (?, ?, 'employee', ?, ?)",
      ).bind(username, await hashPassword(body.password), body.name, body.phone || null).run();
      return json({ ok: true });
    }

    if (path.startsWith('/admin/employees/') && method === 'PATCH') {
      const id = Number(path.split('/')[3]);
      if (body.password) {
        await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .bind(await hashPassword(body.password), id).run();
      }
      if (body.active !== undefined) {
        await env.DB.prepare('UPDATE users SET active = ? WHERE id = ?').bind(body.active ? 1 : 0, id).run();
      }
      return json({ ok: true });
    }
  }

  /* ---------- employee ---------- */

  if (path.startsWith('/emp/')) {
    const emp = await requireUser(request, env, 'employee');
    if (!emp) return fail('Sign in to see your jobs', 401);

    if (path === '/emp/dashboard' && method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT a.id AS assignment_id, a.due_date, a.notes, a.created_at,
               t.key AS task_key, t.name AS task_name,
               s.id AS row_id, s.status, s.done_at,
               si.id AS site_id, si.name AS site_name
        FROM assignments a
        JOIN tasks t ON t.id = a.task_id
        JOIN assignment_sites s ON s.assignment_id = a.id
        JOIN sites si ON si.id = s.site_id
        WHERE a.employee_id = ? AND a.status = 'open'
        ORDER BY a.created_at DESC, si.name
      `).bind(emp.id).all();

      const byAssignment = new Map();
      for (const r of results) {
        if (!byAssignment.has(r.assignment_id)) {
          byAssignment.set(r.assignment_id, {
            assignment_id: r.assignment_id, task_key: r.task_key, task_name: r.task_name,
            due_date: r.due_date, notes: r.notes, created_at: r.created_at, sites: [],
          });
        }
        byAssignment.get(r.assignment_id).sites.push({
          site_id: r.site_id, site_name: r.site_name, status: r.status, done_at: r.done_at,
        });
      }
      const assignments = [...byAssignment.values()];
      const pending = assignments.reduce((n, a) => n + a.sites.filter((s) => s.status === 'pending').length, 0);
      return json({
        ok: true,
        employee: { id: emp.id, name: emp.name },
        pending,
        mute_until: emp.mute_until,
        night: { start: Number(env.NIGHT_START || 21), end: Number(env.NIGHT_END || 6) },
        assignments,
      });
    }

    // Read-only "Diesel Left" straight from the spreadsheet.
    if (path === '/emp/diesel' && method === 'GET') {
      const siteId = Number(url.searchParams.get('site_id'));
      const site = siteId ? await env.DB.prepare('SELECT diesel_cell FROM sites WHERE id = ?').bind(siteId).first() : null;
      const range = site?.diesel_cell || env.DIESEL_RANGE;
      if (!range) return json({ ok: true, value: null, note: 'Diesel cell not configured yet' });
      try {
        return json({ ok: true, value: await readRange(env, range), range });
      } catch (err) {
        return json({ ok: true, value: null, note: err.message });
      }
    }

    if (path === '/emp/submit' && method === 'POST') {
      if (body.task_key !== 'office_self_vehicle') return fail('Unknown task form');
      const siteId = Number(body.site_id);
      const assignmentId = Number(body.assignment_id) || null;
      if (!siteId) return fail('Pick a site');
      if (!body.reading_date) return fail('Pick a date');
      if (!String(body.tanker_reading || '').trim()) return fail('Enter the tanker reading');
      if (!String(body.dg_hours || '').trim()) return fail('Enter the DG hours reading');

      if (body.client_uuid) {
        const dupe = await env.DB.prepare('SELECT id FROM submissions WHERE client_uuid = ?').bind(body.client_uuid).first();
        if (dupe) return json({ ok: true, duplicate: true, id: dupe.id });
      }

      const site = await env.DB.prepare('SELECT id, name, sheet_tab FROM sites WHERE id = ?').bind(siteId).first();
      if (!site) return fail('That site is no longer active');

      const row = await env.DB.prepare(`
        INSERT INTO submissions
          (assignment_id, employee_id, site_id, task_key, reading_date, tanker_reading, dg_hours, diesel_left, client_uuid)
        VALUES (?, ?, ?, 'office_self_vehicle', ?, ?, ?, ?, ?) RETURNING id
      `).bind(
        assignmentId, emp.id, siteId, body.reading_date,
        String(body.tanker_reading), String(body.dg_hours),
        body.diesel_left ?? null, body.client_uuid || null,
      ).first();

      if (assignmentId) {
        await env.DB.prepare(
          "UPDATE assignment_sites SET status = 'done', done_at = ? WHERE assignment_id = ? AND site_id = ?",
        ).bind(nowIso(), assignmentId, siteId).run();
        const left = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM assignment_sites WHERE assignment_id = ? AND status = 'pending'",
        ).bind(assignmentId).first();
        if (left.n === 0) {
          await env.DB.prepare("UPDATE assignments SET status = 'done' WHERE id = ?").bind(assignmentId).run();
        }
      }

      // Push to the spreadsheet. A sheet failure never loses the reading.
      let sheet = { status: 'synced', range: '', error: null };
      try {
        sheet.range = await appendReading(env, site.sheet_tab || env.SHEET_TAB || 'TNK FD', {
          dateTime: `${body.reading_date} ${stamp(env.TIMEZONE).slice(11)}`,
          siteName: site.name,
          dgHours: String(body.dg_hours),
          tankerReading: String(body.tanker_reading),
        });
      } catch (err) {
        sheet = { status: 'failed', range: '', error: err.message };
      }
      await env.DB.prepare('UPDATE submissions SET sheet_status = ?, sheet_row = ?, sheet_error = ? WHERE id = ?')
        .bind(sheet.status, sheet.range, sheet.error, row.id).run();

      return json({ ok: true, id: row.id, sheet: sheet.status, sheet_error: sheet.error });
    }

    if (path === '/emp/history' && method === 'GET') {
      const { results } = await env.DB.prepare(`
        SELECT sub.id, sub.reading_date, sub.tanker_reading, sub.dg_hours, sub.sheet_status,
               sub.submitted_at, si.name AS site_name
        FROM submissions sub JOIN sites si ON si.id = sub.site_id
        WHERE sub.employee_id = ? ORDER BY sub.submitted_at DESC LIMIT 50
      `).bind(emp.id).all();
      return json({ ok: true, submissions: results });
    }

    // Hourly reminders can only be switched off during night hours.
    if (path === '/emp/mute' && method === 'POST') {
      const start = Number(env.NIGHT_START || 21);
      const end = Number(env.NIGHT_END || 6);
      const hour = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: env.TIMEZONE || 'Asia/Kolkata', hour: '2-digit', hour12: false,
      }).format(new Date()));
      const isNight = start > end ? hour >= start || hour < end : hour >= start && hour < end;
      if (!isNight) {
        return fail(`Reminders can only be paused between ${start}:00 and ${end}:00`, 403);
      }
      const until = nextLocalHour(env.TIMEZONE || 'Asia/Kolkata', end);
      await env.DB.prepare('UPDATE users SET mute_until = ? WHERE id = ?').bind(until.toISOString(), emp.id).run();
      return json({ ok: true, mute_until: until.toISOString() });
    }

    if (path === '/emp/unmute' && method === 'POST') {
      await env.DB.prepare('UPDATE users SET mute_until = NULL WHERE id = ?').bind(emp.id).run();
      return json({ ok: true });
    }
  }

  return fail('No such endpoint', 404);
}
