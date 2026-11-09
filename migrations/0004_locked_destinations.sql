-- Locked network recovery destinations and owner-scoped per-asset destination selections.
-- The executor destination remains immutable; overrides must match the grant's deployed destination.
UPDATE recovery_destinations
SET is_active = 0
WHERE is_active = 1
  AND rowid NOT IN (
    SELECT MAX(rowid) FROM recovery_destinations WHERE is_active = 1 GROUP BY network
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_destinations_one_active_per_network
  ON recovery_destinations(network) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS recovery_asset_destinations (
  grant_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  destination_id TEXT NOT NULL REFERENCES recovery_destinations(id),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(grant_id, asset_id),
  FOREIGN KEY(grant_id, asset_id) REFERENCES recovery_grant_assets(grant_id, asset_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_recovery_asset_destinations_destination
  ON recovery_asset_destinations(destination_id);
