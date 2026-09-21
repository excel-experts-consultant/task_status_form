# FieldOps v2

Admin web console + Android app for site jobs, tanker and DG hour readings.

- Web:    https://fieldops-bi0.pages.dev
- Health: https://fieldops-bi0.pages.dev/api/health
- APK:    built by GitHub Actions on every push

## Fresh install (Windows)

Put this folder at `C:\fieldops` (outside `htdocs`), then double-click in order:

| Script | What it does |
|---|---|
| `1-setup.bat` | Wipes the database, creates 25 admin + 5 employee logins, optionally adds 3 test sites, publishes the site. Logins land in `private\logins.csv`. |
| `2-deploy.bat` | Publishes changes to the live site. Use after editing anything in `public\` or `functions\`. |
| `3-push-to-github.bat` | Replaces the GitHub repo with this folder, which triggers a new APK build. |

Everything always publishes to **Production** (`--branch fieldops`), which is where
the dashboard bindings live. Preview deployments were the cause of the v1 login error.

## Checking it works

Open `/api/health`. You want to see `"database": "connected"` and user counts.
`google_service_account` stays "not set" until you do the step below; everything
except the Diesel Left readout and the sheet write works without it.

## Google Sheets (when ready)

1. Google Cloud console → enable **Google Sheets API** → create a **service account** → **JSON key**.
2. Share the spreadsheet with the service account's `client_email` as **Editor**.
3. Cloudflare → Workers & Pages → fieldops → Settings → Variables and Secrets → **Production** →
   Add → Secret → name `GOOGLE_SERVICE_ACCOUNT`, value = the whole JSON file contents.
4. Double-click `2-deploy.bat`. `/api/health` then shows `diesel_left_test` with the H2 value.

Submissions made before this are kept and can be pushed with **Retry failed sheet writes**
on the admin Readings page.

## Other settings

`wrangler.toml` holds the sheet id, `'TNK FD'!H2` diesel cell, timezone and the 21:00–06:00
night window. Edit, save, run `2-deploy.bat`.

## Adding people

Admin console → Employees → Create login. Or regenerate everything with `1-setup.bat`
(this wipes all data).

## APK updates

Every build is signed with the same key (`ci\debug.keystore`), so new APKs install over
the old one without uninstalling. The one exception is the first v2 install: uninstall
the old v1 app once, because it was signed with a different key.
