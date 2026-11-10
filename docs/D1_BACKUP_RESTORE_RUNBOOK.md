# Mainwell D1 Backup and Restore Runbook

## Production database

- Database: `mainwell`
- Binding: `DB`
- Database ID is held in the Cloudflare account configuration; confirm it before any destructive operation.
- D1 data backups do not include Worker code, Worker bindings, secrets, RPC credentials, or operator private keys. Those are separate recovery items and must be preserved independently.

## Recovery points

Cloudflare D1 Time Travel bookmarks are the first-line point-in-time recovery mechanism. A fresh production bookmark was successfully retrieved on 2026-11-10:

```text
00000039-0000001c-0000511f-a501c99e0de1a5eb01034ce526a70644
```

Before applying a production schema migration, changing account data in bulk, or performing a risky administrative operation:

1. Retrieve and securely record a fresh D1 Time Travel bookmark.
2. Record the UTC time, database ID, change being made, and current Git commit.
3. Confirm that both persistent runtime switches remain `automation_enabled=false` and `execution_enabled=false`.
4. Do not assume a bookmark protects Worker secrets, bindings, or code.

Check the currently available Time Travel recovery window in the Cloudflare dashboard before choosing a recovery point. Do not assume a retention period without verifying the account's current plan and settings.

## Point-in-time restore procedure

A restore replaces the current D1 database state and is destructive to changes made after the selected bookmark.

1. Obtain explicit operator approval for the exact production restore point.
2. Pause the Worker cron trigger / application writes for the maintenance window. Do not rely only on recovery switches because wallet monitoring and administrative writes can still touch D1.
3. Retrieve and record a fresh pre-restore bookmark. The restore API returns a `previous_bookmark`; record it as the immediate rollback point.
4. Confirm the target account, database ID, and bookmark a second time.
5. Use Cloudflare D1 Time Travel restore with the selected bookmark.
6. Verify database connectivity, migration ledger, required tables and indexes, administrator account/session state, and audit history.
7. Verify `automation_enabled=false` and `execution_enabled=false` directly in D1.
8. Verify Worker bindings, secrets, cron configuration and deployed artifact independently; D1 restore does not restore those resources.
9. Resume traffic only after the application schema and runtime checks pass.

Never perform a production restore as a routine test. A restore test must use a separate disposable D1 database and a controlled copy, not the live Mainwell database.

## Portable SQL export

For a portable SQL backup, use the Cloudflare D1 export API with `output_format: "polling"` and the default D1-compatible dump format. Poll using the returned bookmark until the export completes, then download the returned signed URL before it expires (one hour). Store the dump encrypted in a separate, access-controlled location and verify its checksum.

Cloudflare documents that an in-progress export may make the D1 database unavailable to serve queries; it must be continually polled or it may cancel. Schedule exports during a maintenance window, keep polling until completion, and do not start an export during normal peak use. The signed URL is sensitive and must not be pasted into chat, logs, source control, or a public issue.

## Restore readiness boundary

- The production Time Travel bookmark was retrieved and verified.
- The restore procedure is documented.
- A destructive restore has **not** been run against production.
- A separate-database restore rehearsal and portable SQL export have **not** yet been completed. Do not claim a fully tested disaster-recovery process until those are done.
