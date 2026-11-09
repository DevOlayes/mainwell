-- Mainwell initial persistence schema.
-- No seed phrases, private keys, wallet passwords, or signing secrets are stored.

CREATE TABLE IF NOT EXISTS recovery_wallets (
  id TEXT PRIMARY KEY,
  owner_address TEXT NOT NULL,
  network TEXT NOT NULL,
  chain_id INTEGER,
  status TEXT NOT NULL DEFAULT 'monitoring' CHECK (status IN ('monitoring', 'paused', 'revoked')),
  first_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_address, network)
);

CREATE TABLE IF NOT EXISTS recovery_grants (
  grant_id TEXT PRIMARY KEY,
  owner_wallet TEXT NOT NULL,
  network TEXT NOT NULL,
  chain_id INTEGER,
  executor_address TEXT NOT NULL,
  executor_code_hash TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  execution_modes_json TEXT NOT NULL CHECK (json_valid(execution_modes_json)),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('onchain-approval', 'permit', 'smart-account-session')),
  evidence_reference TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'invalid', 'revoked', 'expired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recovery_grants_owner_network
  ON recovery_grants(owner_wallet, network, verification_status);

CREATE TABLE IF NOT EXISTS recovery_grant_assets (
  grant_id TEXT NOT NULL REFERENCES recovery_grants(grant_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  token_address TEXT,
  amount_kind TEXT NOT NULL CHECK (amount_kind IN ('capped', 'unlimited-allowance')),
  max_amount_raw TEXT,
  owner_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (owner_acknowledged IN (0, 1)),
  PRIMARY KEY(grant_id, asset_id),
  CHECK (
    (amount_kind = 'capped' AND max_amount_raw IS NOT NULL AND length(max_amount_raw) > 0)
    OR
    (amount_kind = 'unlimited-allowance' AND owner_acknowledged = 1)
  )
);

CREATE TABLE IF NOT EXISTS recovery_destinations (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  locked INTEGER NOT NULL CHECK (locked IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(network, address)
);

CREATE TABLE IF NOT EXISTS wallet_assets (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES recovery_wallets(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  asset_ref TEXT NOT NULL,
  token_address TEXT,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 255),
  estimated_value_usd REAL,
  price_observed_at TEXT,
  valuation_confidence REAL CHECK (valuation_confidence IS NULL OR valuation_confidence BETWEEN 0 AND 1),
  observed_at TEXT NOT NULL,
  UNIQUE(wallet_id, network, asset_ref)
);

CREATE INDEX IF NOT EXISTS idx_wallet_assets_wallet_observed
  ON wallet_assets(wallet_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS recovery_jobs (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES recovery_grants(grant_id),
  asset_id TEXT NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('automatic-priority', 'admin-initiated')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'simulating', 'ready', 'submitted', 'confirmed', 'failed', 'blocked', 'cancelled')),
  priority_score REAL NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recovery_jobs_status_priority
  ON recovery_jobs(status, priority_score DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS recovery_transactions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES recovery_jobs(id),
  network TEXT NOT NULL,
  transaction_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'submitted', 'pending', 'confirmed', 'reverted', 'replaced', 'unknown')),
  asset_id TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  estimated_fee_raw TEXT,
  actual_fee_raw TEXT,
  submitted_at TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(network, transaction_hash)
);

CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  mfa_enabled INTEGER NOT NULL DEFAULT 0 CHECK (mfa_enabled IN (0, 1)),
  mfa_secret_ciphertext TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  mfa_verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
  ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'admin', 'system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_target
  ON audit_events(target_type, target_id, created_at DESC);
