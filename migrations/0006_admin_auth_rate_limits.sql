-- Hashed administrator login throttling; no raw email or IP is stored.
CREATE TABLE IF NOT EXISTS admin_auth_rate_limits (
  identifier_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_admin_auth_rate_limits_locked_until
  ON admin_auth_rate_limits(locked_until);
