-- Serialize transaction signing per operator and network to prevent nonce collisions.
CREATE TABLE IF NOT EXISTS recovery_execution_locks (
  network TEXT NOT NULL,
  operator_address TEXT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(network, operator_address)
);
CREATE INDEX IF NOT EXISTS idx_recovery_execution_locks_expiry
  ON recovery_execution_locks(lease_expires_at);
