-- Admin-controlled source-wallet registry.
-- Only source wallets explicitly locked by an authenticated administrator are eligible for grant verification.
ALTER TABLE recovery_wallets ADD COLUMN admin_locked INTEGER NOT NULL DEFAULT 0 CHECK (admin_locked IN (0, 1));
ALTER TABLE recovery_wallets ADD COLUMN locked_by TEXT;
ALTER TABLE recovery_wallets ADD COLUMN locked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_recovery_wallets_admin_locked
  ON recovery_wallets(owner_address, network, admin_locked);
