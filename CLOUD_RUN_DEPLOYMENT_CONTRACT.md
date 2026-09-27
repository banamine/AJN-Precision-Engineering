# Cloud Run Deployment Contract

This repository deploys as one Cloud Run service. The service runs the
production Node/Express API and serves the built TV Stream Guide from the same
process.

## Runtime

- Node.js: `24.13.0`
- pnpm: `10.26.1`
- Install: `pnpm install --frozen-lockfile`
- Build: `PORT=8080 BASE_PATH=/ pnpm run build`
- Start: `node --enable-source-maps artifacts/api-server/dist/index.mjs`

The Dockerfile uses the same package manager, lockfile, and root build
contract. No secret values are stored in the image or repository.

## Networking and topology

One Cloud Run service contains:

- Node/Express API process
- Static frontend at `/app/artifacts/tv-stream-guide/dist/public`

The service listens on the Cloud Run-provided `$PORT` and binds to
`0.0.0.0`.

Routes:

- `/` and frontend routes: static TV Stream Guide with SPA fallback
- `/api/*`: Express API routes
- `/api/healthz`: process liveness
- `/api/readyz`: application and PostgreSQL readiness
- `/api/v1/*`: application API

The frontend keeps its same-origin `/api` base URL. No browser-visible
secondary API origin or hardcoded production domain is required.

## Environment variables and secrets

Required:

- `PORT` — supplied by Cloud Run
- `DATABASE_URL` — managed runtime secret for PostgreSQL

Optional:

- `DIRECTUS_URL` — server-only Directus base URL
- `DIRECTUS_TOKEN` — server-only Directus bearer token
- `DIRECTUS_ALLOWED_HOSTS` — comma-separated exact Directus service hosts
- `DIRECTUS_MEDIA_ALLOWED_HOSTS` — comma-separated exact media delivery hosts
- `CORS_ORIGINS` — comma-separated browser origins allowed to call the API

`STATIC_ROOT` is set by the container to the built frontend directory.
`BASE_PATH=/` is a build-time value for the single-service root route.

## Health and readiness

- `GET /api/healthz` is liveness only and does not require PostgreSQL.
- `GET /api/readyz` executes a real `SELECT 1` through the PostgreSQL pool.
- Readiness returns `200 {"status":"ready"}` only when the required database
  configuration exists and the query succeeds.
- Missing configuration or an unavailable database returns
  `503 {"status":"not_ready","database":"unavailable"}`.
- Health responses never include connection strings, passwords, tokens, or
  other secret values.

## Directus policy

Directus is optional for this deployment contract. When it is absent:

- the application remains operational;
- Directus status reports `NOT_CONFIGURED`;
- Directus content and shadow-comparison routes return `503`;
- no Directus content is fabricated or promoted to playback.

If Directus becomes required for production content, configure its two
server-only variables as a later deployment prerequisite.

## Verification

Before staging publication, verify:

```bash
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/tv-stream-guide run typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/tv-stream-guide test
PORT=25987 BASE_PATH=/ pnpm run build
```

With Docker and a real test PostgreSQL URL available:

```bash
docker build -t ajn-cloud-run-readiness .
docker run --rm \
  -e PORT=8080 \
  -e DATABASE_URL="$TEST_DATABASE_URL" \
  -p 8080:8080 \
  ajn-cloud-run-readiness
```

Then check `/`, `/api/healthz`, and `/api/readyz`. Do not print the database
URL.