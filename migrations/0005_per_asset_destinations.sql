-- Bind every EVM grant asset to its own owner-approved immutable destination.
ALTER TABLE recovery_grant_assets ADD COLUMN destination_address TEXT NOT NULL DEFAULT '';
UPDATE recovery_grant_assets
SET destination_address = (
  SELECT LOWER(g.destination_address) FROM recovery_grants g
  WHERE g.grant_id = recovery_grant_assets.grant_id
)
WHERE destination_address = '';

-- Multiple locked destinations may be active on the same network; asset policy selects one.
DROP INDEX IF EXISTS idx_recovery_destinations_one_active_per_network;
CREATE INDEX IF NOT EXISTS idx_recovery_destinations_network_active
  ON recovery_destinations(network, is_active, locked);

CREATE TABLE IF NOT EXISTS recovery_asset_destination_policies (
  network TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  destination_id TEXT NOT NULL REFERENCES recovery_destinations(id),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(network, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_recovery_asset_destination_policies_destination
  ON recovery_asset_destination_policies(destination_id);

-- Existing per-grant selections remain historical and are not authoritative unless they
-- exactly match the asset's immutable on-chain destination.
