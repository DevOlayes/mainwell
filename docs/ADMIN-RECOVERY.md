# One-time administrator recovery

The `/admin/recover-once` route is backed by the singleton `admin_recovery_state` row created by migration `0011_admin_one_time_recovery.sql`.

Recovery requires the existing `MAINWELL_ADMIN_BOOTSTRAP_TOKEN`, the currently enrolled six-digit TOTP, and a new password of at least 14 characters. The existing MFA ciphertext and enrollment are preserved. A successful recovery replaces only the password hash, consumes the singleton recovery state in the same D1 batch, revokes existing administrator sessions, and records an audit event.

The recovery endpoint is rate-limited by a hashed client identifier. Once `consumed_at` is set, both the page and API fail closed. Re-enabling recovery is intentionally not exposed through the application; it requires a separately reviewed and explicitly authorized database migration after the operator requests it.

The administrator authentication module is separate from the dashboard and recovery UI. Changes to authentication must retain the password-hash, TOTP, login, and recovery regression checks in CI. Never log or commit password values, bootstrap tokens, MFA codes, encrypted MFA material, or password hashes.
