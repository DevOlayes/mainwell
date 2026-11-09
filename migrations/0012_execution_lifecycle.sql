-- Phase Two execution lifecycle foundation.
-- This migration only prepares durable queue/attempt/receipt metadata. It does not enable signing or transfers.
ALTER TABLE recovery_jobs ADD COLUMN requested_amount_raw TEXT;
ALTER TABLE recovery_jobs ADD COLUMN destination_address TEXT;
ALTER TABLE recovery_jobs ADD COLUMN next_attempt_at TEXT;
ALTER TABLE recovery_jobs ADD COLUMN lease_owner TEXT;
ALTER TABLE recovery_jobs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE recovery_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recovery_jobs ADD COLUMN last_error_code TEXT;
ALTER TABLE recovery_jobs ADD COLUMN last_error_at TEXT;
ALTER TABLE recovery_jobs ADD COLUMN started_at TEXT;
ALTER TABLE recovery_jobs ADD COLUMN completed_at TEXT;
ALTER TABLE recovery_jobs ADD COLUMN cancelled_at TEXT;

ALTER TABLE recovery_transactions ADD COLUMN sender_address TEXT;
ALTER TABLE recovery_transactions ADD COLUMN nonce INTEGER;
ALTER TABLE recovery_transactions ADD COLUMN gas_limit_raw TEXT;
ALTER TABLE recovery_transactions ADD COLUMN max_fee_per_gas_raw TEXT;
ALTER TABLE recovery_transactions ADD COLUMN max_priority_fee_per_gas_raw TEXT;
ALTER TABLE recovery_transactions ADD COLUMN gas_price_raw TEXT;
ALTER TABLE recovery_transactions ADD COLUMN block_number INTEGER;
ALTER TABLE recovery_transactions ADD COLUMN block_hash TEXT;
ALTER TABLE recovery_transactions ADD COLUMN gas_used_raw TEXT;
ALTER TABLE recovery_transactions ADD COLUMN effective_gas_price_raw TEXT;
ALTER TABLE recovery_transactions ADD COLUMN replacement_of TEXT;
ALTER TABLE recovery_transactions ADD COLUMN failure_code TEXT;
ALTER TABLE recovery_transactions ADD COLUMN last_checked_at TEXT;

CREATE TABLE IF NOT EXISTS recovery_execution_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES recovery_jobs(id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  phase TEXT NOT NULL CHECK (phase IN ('preflight','simulated','signed','submitted','confirmed','failed','blocked')),
  simulation_block_number INTEGER,
  gas_funding_source TEXT CHECK (gas_funding_source IS NULL OR gas_funding_source IN ('compromised-wallet','recovery-sponsor','unavailable')),
  estimated_fee_raw TEXT,
  fee_cap_raw TEXT,
  transaction_hash TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS recovery_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES recovery_jobs(id),
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner','admin','system')),
  actor_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recovery_jobs_execution_queue
  ON recovery_jobs(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_recovery_jobs_lease
  ON recovery_jobs(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_recovery_transactions_pending
  ON recovery_transactions(network, status, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_recovery_attempts_job
  ON recovery_execution_attempts(job_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_recovery_job_events_job
  ON recovery_job_events(job_id, created_at);
CREATE TRIGGER IF NOT EXISTS recovery_job_events_no_update
BEFORE UPDATE ON recovery_job_events
BEGIN SELECT RAISE(ABORT, 'recovery job events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS recovery_job_events_no_delete
BEFORE DELETE ON recovery_job_events
BEGIN SELECT RAISE(ABORT, 'recovery job events are append-only'); END;
