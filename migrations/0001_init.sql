-- Saved designs, keyed by an anonymous per-browser uid.
CREATE TABLE IF NOT EXISTS designs (
  id            TEXT PRIMARY KEY,
  uid           TEXT NOT NULL,
  name          TEXT,
  building_type TEXT,
  prompt        TEXT,
  spec          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_designs_uid ON designs(uid, updated_at DESC);
