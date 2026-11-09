-- Persist the exact execution operator identities embedded in each immutable executor.
ALTER TABLE recovery_grants ADD COLUMN automation_operator TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000';
ALTER TABLE recovery_grants ADD COLUMN admin_operator TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000';
