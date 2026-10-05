-- Run once on the live D1 database.
--   1. adds the superadmin flag to users
--   2. forces every existing username to lowercase
--
-- Safe to re-run: "duplicate column name: is_super" just means step 1 already
-- applied, and step 2 is idempotent.

ALTER TABLE users ADD COLUMN is_super INTEGER NOT NULL DEFAULT 0;

UPDATE users SET username = lower(username) WHERE username <> lower(username);
