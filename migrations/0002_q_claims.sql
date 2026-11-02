-- Additive replacement: q_signups is retained as an untouched archive.
CREATE TABLE IF NOT EXISTS q_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ao_slug TEXT NOT NULL,
  event_date TEXT NOT NULL,
  q_slug TEXT,
  q_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  coupon INTEGER NOT NULL CHECK (coupon IN (0,1)),
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  publish_status TEXT NOT NULL DEFAULT 'scheduled' CHECK (publish_status IN ('scheduled','publishing','posted','failed')),
  published_at TEXT,
  publish_error TEXT,
  UNIQUE (ao_slug,event_date)
);
CREATE INDEX IF NOT EXISTS q_claims_publication ON q_claims(publish_status,event_date,scheduled_for);
CREATE INDEX IF NOT EXISTS q_claims_rate ON q_claims(ip_hash,created_at);
