-- Phase Three: durable wallet monitoring, asset lifecycle and permission history.
ALTER TABLE recovery_wallets ADD COLUMN last_monitor_at TEXT;
ALTER TABLE recovery_wallets ADD COLUMN monitoring_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE recovery_wallets ADD COLUMN monitoring_error TEXT;
ALTER TABLE wallet_assets ADD COLUMN first_seen_at TEXT;
ALTER TABLE wallet_assets ADD COLUMN last_seen_at TEXT;
ALTER TABLE wallet_assets ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE wallet_assets ADD COLUMN missing_since TEXT;
ALTER TABLE wallet_assets ADD COLUMN discovery_source TEXT NOT NULL DEFAULT 'configured';
ALTER TABLE wallet_assets ADD COLUMN token_verified INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_recovery_wallets_monitor_due
  ON recovery_wallets(status, last_monitor_at, network);

CREATE TABLE IF NOT EXISTS wallet_asset_history (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES recovery_wallets(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  asset_ref TEXT NOT NULL,
  token_address TEXT,
  symbol TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  estimated_value_usd REAL,
  price_observed_at TEXT,
  valuation_confidence REAL,
  lifecycle_status TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_asset_history_wallet_time
  ON wallet_asset_history(wallet_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS wallet_permissions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES recovery_wallets(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  token_address TEXT NOT NULL,
  spender_address TEXT NOT NULL,
  allowance_raw TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked','unknown')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(wallet_id, network, token_address, spender_address)
);
CREATE INDEX IF NOT EXISTS idx_wallet_permissions_wallet_status
  ON wallet_permissions(wallet_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS wallet_permission_history (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES recovery_wallets(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  token_address TEXT NOT NULL,
  spender_address TEXT NOT NULL,
  allowance_raw TEXT NOT NULL,
  status TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_permission_history_wallet_time
  ON wallet_permission_history(wallet_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS wallet_monitoring_runs (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES recovery_wallets(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success','partial','failed')),
  discovered_assets INTEGER NOT NULL DEFAULT 0,
  priced_assets INTEGER NOT NULL DEFAULT 0,
  permission_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_monitoring_runs_time
  ON wallet_monitoring_runs(completed_at DESC);
