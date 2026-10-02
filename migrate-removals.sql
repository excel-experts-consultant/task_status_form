-- FieldOps migration: removal requests + split reassignment
-- Run ONCE against the live database. It only adds things; nothing is dropped.
--   npx wrangler d1 execute fieldops --remote --file=./migrate-removals.sql

-- An employee asking the admin to take the untouched sites off a job
-- they have already partly completed.
CREATE TABLE IF NOT EXISTS removal_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  requested_by  INTEGER NOT NULL REFERENCES users(id),
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','resolved','declined','withdrawn')),
  admin_note    TEXT,
  resolved_by   INTEGER REFERENCES users(id),
  resolved_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rr_status ON removal_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_rr_assign ON removal_requests(assignment_id, status);

-- Audit trail: one row per site actually moved from one employee to another.
CREATE TABLE IF NOT EXISTS reassignments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id         INTEGER REFERENCES removal_requests(id),
  site_id            INTEGER NOT NULL REFERENCES sites(id),
  from_assignment_id INTEGER NOT NULL REFERENCES assignments(id),
  to_assignment_id   INTEGER NOT NULL REFERENCES assignments(id),
  from_employee_id   INTEGER NOT NULL REFERENCES users(id),
  to_employee_id     INTEGER NOT NULL REFERENCES users(id),
  moved_by           INTEGER NOT NULL REFERENCES users(id),
  moved_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_re_from ON reassignments(from_assignment_id);

-- Lets a reassignment land in one tidy follow-on job per receiving employee
-- instead of a new job every time the admin ticks another batch of sites.
ALTER TABLE assignments ADD COLUMN source_assignment_id INTEGER REFERENCES assignments(id);
