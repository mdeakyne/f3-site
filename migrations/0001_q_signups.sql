-- D1 schema for Q signup pipeline.
-- Rows are inserted by the Worker at POST /api/q-signup and pulled weekly
-- by `nob pull-signups`, which promotes approved rows into
-- `07 - F3/Q Schedule/YYYY-MM.md` in the Obsidian vault.

CREATE TABLE IF NOT EXISTS q_signups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_date   TEXT    NOT NULL,              -- ISO YYYY-MM-DD
  ao_slug      TEXT    NOT NULL,
  f3_name      TEXT    NOT NULL,
  contact      TEXT,                           -- phone or email, optional
  notes        TEXT,
  ip_hash      TEXT    NOT NULL,               -- sha256(ip + salt) for rate-limit
  status       TEXT    NOT NULL DEFAULT 'pending',  -- pending | processed | rejected
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_q_signups_status      ON q_signups(status);
CREATE INDEX IF NOT EXISTS idx_q_signups_event_date  ON q_signups(event_date);
CREATE INDEX IF NOT EXISTS idx_q_signups_ip_created  ON q_signups(ip_hash, created_at);
