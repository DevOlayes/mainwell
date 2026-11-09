-- Track per-asset on-chain revocation independently from whole-grant revocation.
ALTER TABLE recovery_grant_assets ADD COLUMN revoked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_recovery_grant_assets_revoked
  ON recovery_grant_assets(grant_id, revoked_at);
