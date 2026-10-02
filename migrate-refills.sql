-- Run once on the live D1 database to add the standalone diesel-refilling log.
-- Safe to re-run: "table refills already exists" just means it was applied.

CREATE TABLE IF NOT EXISTS refills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES users(id),
  site_text     TEXT NOT NULL,
  credit_litres TEXT NOT NULL,
  meter_reading TEXT NOT NULL,
  client_uuid   TEXT UNIQUE,
  sheet_status  TEXT NOT NULL DEFAULT 'synced',
  sheet_row     TEXT,
  sheet_error   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
