CREATE TABLE IF NOT EXISTS admin_recovery_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  consumed_at TEXT,
  consumed_by TEXT,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO admin_recovery_state (id, consumed_at, consumed_by, created_at)
VALUES (1, NULL, NULL, datetime('now'));
