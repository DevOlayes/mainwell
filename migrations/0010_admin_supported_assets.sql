CREATE TABLE IF NOT EXISTS recovery_supported_assets (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  token_address TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(network, token_address)
);
CREATE INDEX IF NOT EXISTS idx_recovery_supported_assets_network_active
  ON recovery_supported_assets(network, is_active);
