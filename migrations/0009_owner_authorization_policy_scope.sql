-- Persist administrator-defined per-asset recovery bounds and allowed execution modes.
-- These are policy defaults only; the wallet owner must approve the exact values on-chain.
ALTER TABLE recovery_asset_destination_policies
  ADD COLUMN max_amount_raw TEXT NOT NULL DEFAULT '0';
ALTER TABLE recovery_asset_destination_policies
  ADD COLUMN automatic_priority_enabled INTEGER NOT NULL DEFAULT 0 CHECK (automatic_priority_enabled IN (0,1));
ALTER TABLE recovery_asset_destination_policies
  ADD COLUMN admin_initiated_enabled INTEGER NOT NULL DEFAULT 1 CHECK (admin_initiated_enabled IN (0,1));
ALTER TABLE recovery_asset_destination_policies
  ADD COLUMN expires_in_seconds INTEGER NOT NULL DEFAULT 604800 CHECK (expires_in_seconds BETWEEN 3600 AND 31536000);
