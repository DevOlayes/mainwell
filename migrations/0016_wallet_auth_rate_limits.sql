-- Rate-limit owner wallet-auth challenge and verification requests by a one-way IP identifier.
-- Raw client IP addresses are never persisted.
CREATE TABLE IF NOT EXISTS wallet_auth_rate_limits (
  identifier_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_wallet_auth_rate_limits_lock
  ON wallet_auth_rate_limits(locked_until);
