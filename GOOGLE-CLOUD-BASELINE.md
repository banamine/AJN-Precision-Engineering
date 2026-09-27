# AJN Google Cloud Build Baseline

This directory is the authoritative cleaned application tree for the Google
Cloud Run deployment.

## Packaging

The application is provider-neutral at source level and deploys as one
Cloud Run service:

- Node.js / Express API
- React/Vite TV Stream Guide
- `/api/*` API routes
- same-origin frontend and API
- no Replit runtime state
- no Git metadata
- no previous ZIP exports
- no patch/drop-in repair directories

## Reproducible build

- Node.js `24.13.0`
- pnpm `10.26.1`
- `pnpm-lock.yaml` is included
- Docker uses `pnpm install --frozen-lockfile`
- build command: `PORT=8080 BASE_PATH=/ pnpm run build`
- runtime command: `node --enable-source-maps artifacts/api-server/dist/index.mjs`

## Runtime configuration

Required at Cloud Run runtime:

- `PORT` — supplied by Cloud Run
- `DATABASE_URL` — Secret Manager / runtime secret

Optional:

- `DIRECTUS_URL`
- `DIRECTUS_TOKEN`
- `DIRECTUS_ALLOWED_HOSTS`
- `DIRECTUS_MEDIA_ALLOWED_HOSTS`
- `CORS_ORIGINS`

Production secrets are intentionally not stored in this application archive.

## Deployment

`cloudbuild.yaml` builds the Docker image, pushes it to Artifact Registry,
and deploys the image to Cloud Run. The Dockerfile and build contract are part
of this same application tree.

## Verification status

This archive is a full source rebuild prepared for Cloud Run. Local dependency
installation and external Google Cloud deployment are environment-dependent;
no deployment success is claimed until the Cloud Run smoke tests and the
application regression suite pass against the resulting revision.
