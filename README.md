# FieldOps

Admin web console on Cloudflare Pages + an Android app for employees. Admins allocate
**FORM OF OFFICE SELF VEHICLE** (or any future task) to employees across sites; employees see the
job on their dashboard, get hourly reminders, fill the form, and the reading lands in the
**TNK FD** sheet.

```
admin (25 logins)  →  Pages Functions API  →  D1        →  employee app (Android/PWA)
                                           ↘ Google Sheets "TNK FD"
```

Column mapping on submit: **A** date-time, **B** site name, **F** DG hours, **I** tanker reading.
Diesel Left is read back from the sheet and shown read-only at the top of the app.

---

## 1. Cloudflare setup

```bash
npm install
npx wrangler login

npx wrangler d1 create fieldops           # copy the database_id into wrangler.toml
npm run db:schema                         # creates the tables
node scripts/create-users.mjs 25 0        # writes seed-users.sql + users.csv
npm run db:users                          # loads the 25 admin logins
```

`users.csv` holds the plain passwords. Hand them out, then delete the file — the database only
ever stores PBKDF2 hashes.

Secrets and variables:

```bash
npx wrangler pages secret put SESSION_SECRET          # any long random string
npx wrangler pages secret put GOOGLE_SERVICE_ACCOUNT  # paste the whole service-account JSON
```

In `wrangler.toml` set `SHEET_ID` to your spreadsheet id (the part between `/d/` and `/edit`),
and `DIESEL_RANGE` to the Diesel Left cell, e.g. `'TNK FD'!K2`. `NIGHT_START` / `NIGHT_END`
control the window in which employees are allowed to pause reminders — 21:00 to 06:00 by default.

Deploy:

```bash
npm run deploy
```

Then open the Pages project → Settings → Functions → D1 bindings and bind `DB` to the `fieldops`
database (Wrangler does this from `wrangler.toml` on newer versions; check it is there).

## 2. Google Sheets access

1. Google Cloud console → new project → enable **Google Sheets API**.
2. Create a **service account**, then a **JSON key**. That JSON is `GOOGLE_SERVICE_ACCOUNT`.
3. Open your spreadsheet → Share → add the service account's `client_email` as **Editor**.

Nothing else is needed — no OAuth screen, no Apps Script.

## 3. Load the 250 sites

Admin console → **Sites** → paste from your Google Sheet, one site per line:

```
site name, code, region, diesel-left cell
Jaipur Tower 01, JP01, Rajasthan, 'TNK FD'!K4
```

Only the name is required. The per-site diesel cell is optional — sites without one fall back to
`DIESEL_RANGE`. Pasting again updates existing sites rather than duplicating them.
`sites-sample.csv` shows the format.

## 4. Employee logins

Admin console → **Employees** → create a name, username and password. Those are the app logins.
You can reset a password or disable an employee from the same screen.

## 5. Android APK

The whole employee app lives in `public/`, so an APK is just a Capacitor wrapper around it.

First, point the app at your deployed API — edit the top of `public/js/api.js`:

```js
window.FIELDOPS_API = 'https://fieldops.pages.dev';   // your Pages domain
```

Then either build it in the cloud or locally.

**Cloud (no Android Studio):** push this folder to GitHub. `.github/workflows/android.yml` builds
the APK on every push to `main` — download it from the run's Artifacts. Install it on the phones
with "install from unknown sources".

**Locally:**

```bash
npx cap add android
npm run apk           # android/app/build/outputs/apk/debug/app-debug.apk
```

Requires Android Studio (or the command-line SDK) and JDK 21. For a Play-Store-signable release
build, generate a keystore and run `./gradlew assembleRelease`.

Add these to `android/app/src/main/AndroidManifest.xml` if the workflow didn't (it does it for you):

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM"/>
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
```

**Test without an APK:** open the Pages URL on an Android phone in Chrome → menu → *Add to home
screen*. You get the same app, same logins, same notifications while the app has been opened
recently. Good for trialling with two or three employees before you ship the APK.

## How reminders behave

- One repeating hourly notification per employee, scheduled on the phone — it keeps working with
  no signal and no push server.
- It stops by itself when every allocated site has been submitted, and restarts when an admin
  allocates new work (picked up next time the app is opened or comes to the foreground).
- **Pause** is only tappable between 21:00 and 06:00; outside that window the button is disabled
  and the server rejects the request too, so it can't be worked around from a modified client.
  A pause automatically expires at 06:00.

## Adding a second task later

1. `INSERT INTO tasks (key, name) VALUES ('site_inspection', 'SITE INSPECTION FORM');`
2. Add a screen in `public/app.html` keyed on `task_key`.
3. Add a branch in `/emp/submit` in `functions/api/[[path]].js` with that task's column mapping.

The allocation flow, dashboards, reminders and the sites list need no changes.

## Design

Petrol steel and sodium amber, hairline structure instead of drop shadows. Archivo carries headings
and every reading; IBM Plex Sans carries body text, with tabular figures so columns of numbers line
up. Both fonts are bundled, so the Android build renders correctly with no network.

## Files

| Path | What it is |
|---|---|
| `functions/api/[[path]].js` | The whole API: auth, allocation, submissions, Sheets sync |
| `schema.sql` | D1 tables |
| `scripts/create-users.mjs` | Generates the 25 admin logins |
| `public/index.html` | Sign-in for both roles |
| `public/admin.html` | Admin console |
| `public/app.html` | Employee app |
| `public/js/reminders.js` | Hourly reminder engine, night-only pause |
| `public/css/app.css` | Design system: tokens, type scale, components |
| `public/fonts/` | Self-hosted Archivo + IBM Plex Sans (114 KB, works offline in the APK) |
| `.github/workflows/android.yml` | Builds the APK |
