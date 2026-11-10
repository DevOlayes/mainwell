-- Persist the last accepted RFC 6238 time-step to reject authenticator-code replay.
ALTER TABLE admin_accounts ADD COLUMN mfa_last_verified_step INTEGER NOT NULL DEFAULT -1 CHECK (mfa_last_verified_step >= -1);
