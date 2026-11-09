-- Single-use wallet sign-in challenges and hashed owner sessions.
CREATE TABLE IF NOT EXISTS wallet_auth_challenges (
  nonce TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  origin TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_auth_challenges_expiry
  ON wallet_auth_challenges(expires_at);

CREATE TABLE IF NOT EXISTS wallet_sessions (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_wallet
  ON wallet_sessions(wallet_address, expires_at);
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_expiry
  ON wallet_sessions(expires_at);
