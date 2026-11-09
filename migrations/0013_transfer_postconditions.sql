-- Record ERC-20 recipient balance around execution to verify the transfer postcondition.
ALTER TABLE recovery_transactions ADD COLUMN destination_balance_before_raw TEXT;
ALTER TABLE recovery_transactions ADD COLUMN destination_balance_after_raw TEXT;
