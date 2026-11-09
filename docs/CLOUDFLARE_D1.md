# Cloudflare Deployment and D1

Mainwell is deployed as a Cloudflare Worker named `mainwell`. The Worker entry point is `src/worker.ts`, configured in `wrangler.jsonc`.

## Database

The production D1 database is named `mainwell`. The Worker accesses it through the `DB` binding. Its schema is versioned in `migrations/`.

Apply migrations and deploy:

```sh
bun install
bun run check
bun test
bun run deploy
```

The deploy script applies pending remote D1 migrations before deploying the Worker. For local development use:

```sh
bun run db:migrate:local
bun run dev:worker
```

Do not point local development at production D1. Use a local D1 instance or a separate preview database.

## Health checks

- `GET /health` verifies the Worker is responding.
- `GET /api/health/db` performs a read-only D1 query and checks whether the initial schema is present.

These are infrastructure checks only. They do not expose application records or establish that recovery execution is ready.

## Cloudflare Builds

The previous build attempted `npx wrangler deploy` without a Wrangler configuration or a Worker entry point. The committed `wrangler.jsonc` now explicitly identifies the Worker entry point and D1 binding, so Wrangler can package the application instead of looking for a static assets directory.

The Cloudflare build's deploy command should be `bun run deploy` (or `npx wrangler d1 migrations apply mainwell --remote && npx wrangler deploy`). Its build command should run `bun run check && bun test`. Keep all secrets in Worker secrets, never in Git or Wrangler variables.
