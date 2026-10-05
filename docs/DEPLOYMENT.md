# BE-23: deployment runbook

Development and production are separate configurations. `NODE_ENV=development` (see `.env.example`) is
the only relaxed mode; any other value, including unset, is production and the API refuses to start
unless the configuration is safe (secrets of at least 32 characters that differ, no development
sign-in code, no local database password, SMTP configured, no insecure local SMTP). Only names of
bad settings are printed, never values.

## Files

- `Dockerfile` builds the API (multi-stage, runs as the unprivileged `node` user, health check on `/health/ready`)
- `compose.prod.yaml` runs PostgreSQL and the API. PostgreSQL publishes **no** port; only the API is
  published, on `127.0.0.1`, for a reverse proxy on the same host that terminates TLS
- `.env.production` holds the secrets. It is git-ignored and docker-ignored. Start from `.env.example`
  and set at least: `NODE_ENV=production`, `DATABASE_USER/PASSWORD/NAME`, `JWT_SECRET`,
  `AUTH_OTP_SECRET`, `SMTP_HOST`, `SMTP_FROM` (+ `SMTP_USER`/`SMTP_PASSWORD`), `TRUST_PROXY=1` behind one proxy
- Optional: `DOCS_ENABLED=true` with `DOCS_USER` and a 16+ character `DOCS_PASSWORD` to expose the
  Swagger pages behind HTTP Basic; otherwise they are off

## First deployment and every release

1. Back up: `node scripts/db-backup.cjs <postgres-container> <database> <user> backups/<date>.dump`
   (custom format; keep it off the database host)
2. `docker compose -f compose.prod.yaml build`
3. Migrate as one job, before the new API starts, never concurrently:
   `docker compose -f compose.prod.yaml run --rm api npm run migration:show:prod` then
   `docker compose -f compose.prod.yaml run --rm api npm run migration:run:prod`
4. `docker compose -f compose.prod.yaml up -d`
5. Verify: `GET /health/ready` returns `{"status":"ready"}` (the container health check uses it);
   `GET /health` is liveness only

## GitHub Actions CI/CD

`.github/workflows/ci-cd.yml` verifies every pull request and every push to `main`: it installs locked
dependencies, builds, runs the Jest suite, runs the disposable PostgreSQL migration/backup/restore
suite, and builds the production image. A push to `main` is deployed only after all those checks pass.

Prepare the production server once with Docker Compose, Git, Node.js 22, a checkout of this repository,
and an untracked `.env.production`. The SSH account must be able to run Docker without an interactive
password. Configure these secrets on the GitHub `production` environment (environment protection is
recommended):

- `SSH_HOST`, `SSH_PORT`, `SSH_USER`: production SSH connection
- `SSH_PRIVATE_KEY`: private key dedicated to GitHub Actions
- `SSH_KNOWN_HOSTS`: the verified `known_hosts` line for the production server (do not generate it
  inside CI with an unverified `ssh-keyscan`)
- `DEPLOY_PATH`: absolute server checkout path using only letters, digits, `.`, `_`, `-`, and `/`

The deploy job fetches and checks out the exact commit that passed CI. `scripts/deploy.sh` creates a
timestamped pre-deploy database backup when PostgreSQL is already running, builds the API, shows and
runs migrations once, starts the stack, and checks `/health/ready`. If deployment fails after switching
revisions, it rebuilds and starts the previous application revision; already-applied migrations are not
reverted. It retains the existing Compose project name `hodhod`, so the current containers and named
PostgreSQL volume are reused. Move `backups/` off-host and apply a retention policy as part of server
operations.

Migrations are additive and each batch runs in one transaction. Roll the application back first if a
release misbehaves; do not revert migrations that already hold real data (see `docs/DATABASE.md`).

## Restore

Restore into a **new empty** database and verify before switching over:

1. `docker exec <postgres-container> createdb -U <user> hodhod_restored`
2. `node scripts/db-restore.cjs <postgres-container> hodhod_restored <user> backups/<date>.dump`
   (refuses a non-empty database)
3. Point a staging API at it (`DATABASE_NAME=hodhod_restored`), check `/health/ready`, then switch production

`npm run test:db` rehearses this on every run: it backs up the fully migrated, populated test database,
restores it into an empty one, and compares every table's row count, the migration history, foreign keys
and the append-only triggers.

## Logs and monitoring

- The API writes one JSON line per request to stdout: request id, method, path without the query string,
  status and duration. Bodies, headers, tokens, e-mail addresses and query strings are never logged. A caller-supplied
  `X-Request-Id` (plain token only) is echoed, otherwise one is generated; the response always carries it.
- 5xx responses are logged at error level. Collect stdout with the container runtime's log driver.
- Probe `/health/ready` from the load balancer or an external monitor; alert on non-200, on 5xx rate, and
  on `GET /admin/suspicious-events` growth (rejected or implausible attempts).
- Signals are handled (`enableShutdownHooks`), so `docker stop` drains the process.

## Not covered here

TLS certificates and the reverse proxy, log shipping, off-host backup storage, scheduled backups and
their retention. These belong to the server owner and must exist before public release; the checks above
only prove that backups made by the script can be restored.
