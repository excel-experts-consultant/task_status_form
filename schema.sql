-- FieldOps schema (Cloudflare D1 / SQLite)
-- Run by setup.bat. Re-running it WIPES all data and starts fresh.

DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS assignment_sites;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS sites;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS config;

CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','employee')),
  name          TEXT NOT NULL,
  phone         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  -- employee-controlled notification pause; ISO timestamp, only settable at night
  mute_until    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_role ON users(role, active);

CREATE TABLE sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE,              -- optional short code from your sheet
  name        TEXT NOT NULL UNIQUE,     -- the ~250 site names
  region      TEXT,
  -- where this site's "Diesel Left" value lives, e.g.  'TNK FD'!K4
  diesel_cell TEXT,
  -- optional per-site override of the sheet the submission is written to
  sheet_tab   TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_sites_active ON sites(active, name);

CREATE TABLE tasks (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  key      TEXT NOT NULL UNIQUE,   -- machine key, drives which form opens in the app
  name     TEXT NOT NULL,          -- shown in the admin dropdown
  active   INTEGER NOT NULL DEFAULT 1
);

-- One row per (task, employee) allocation made by an admin.
CREATE TABLE assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  employee_id INTEGER NOT NULL REFERENCES users(id),
  assigned_by INTEGER NOT NULL REFERENCES users(id),
  due_date    TEXT,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_assign_emp ON assignments(employee_id, status);

-- The checkbox list of sites attached to an allocation. Completion is per site.
CREATE TABLE assignment_sites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  site_id       INTEGER NOT NULL REFERENCES sites(id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  done_at       TEXT,
  UNIQUE (assignment_id, site_id)
);
CREATE INDEX idx_as_status ON assignment_sites(assignment_id, status);

CREATE TABLE submissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id  INTEGER REFERENCES assignments(id),
  employee_id    INTEGER NOT NULL REFERENCES users(id),
  site_id        INTEGER NOT NULL REFERENCES sites(id),
  task_key       TEXT NOT NULL,
  reading_date   TEXT NOT NULL,          -- date picked by the employee (YYYY-MM-DD)
  tanker_reading TEXT,
  dg_hours       TEXT,
  diesel_left    TEXT,                   -- snapshot of the read-only value at submit time
  sheet_status   TEXT NOT NULL DEFAULT 'pending', -- pending | synced | failed
  sheet_row      TEXT,
  sheet_error    TEXT,
  client_uuid    TEXT UNIQUE,            -- offline-safe idempotency key from the phone
  submitted_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sub_emp ON submissions(employee_id, submitted_at);
CREATE INDEX idx_sub_sync ON submissions(sheet_status);

INSERT INTO tasks (key, name) VALUES
  ('office_self_vehicle', 'FORM OF OFFICE SELF VEHICLE');
