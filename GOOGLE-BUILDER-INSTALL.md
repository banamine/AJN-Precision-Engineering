# AJN Google Cloud Builder — Drop-In Installation

## Purpose

This package is the Google Cloud deployment form of the AJN Cloud TV &
Broadcast Matrix application.

It is **not a Replit deployment package**.

The deployment target is one Cloud Run service containing:

- Node.js / Express API
- React/Vite static application
- `/api/*` API routes
- `/health`-compatible API health routing
- one authoritative Media Center playback owner
- one video element
- one global audio element

## Required build environment

- Google Cloud Build
- Google Cloud Run
- Artifact Registry
- Node.js 24
- pnpm 10.26.1

## Build locally

```bash
corepack enable
corepack prepare pnpm@10.26.1 --activate
pnpm install --no-frozen-lockfile
pnpm exec tsc --build --force
PORT=8080 BASE_PATH=/ pnpm run build
```

## Run locally

```bash
PORT=8080 \
BASE_PATH=/ \
STATIC_ROOT=$PWD/artifacts/tv-stream-guide/dist/public \
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

Expected:

```text
Server listening
```

Then:

```bash
curl -i http://127.0.0.1:8080/api/healthz
```

Expected HTTP 200 with:

```json
{"status":"ok"}
```

## Google Cloud Build

Create an Artifact Registry Docker repository once:

```bash
gcloud artifacts repositories create ajn \
  --repository-format=docker \
  --location=us-west1
```

Submit the build:

```bash
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=_REGION=us-west1,_REPOSITORY=ajn,_IMAGE=ajn-cloud-tv,_SERVICE=ajn-cloud-tv
```

## Cloud Run smoke test

```bash
gcloud run services describe ajn-cloud-tv \
  --region=us-west1 \
  --format='value(status.url)'
```

Then:

```bash
curl -i "$(gcloud run services describe ajn-cloud-tv \
  --region=us-west1 \
  --format='value(status.url)')/api/healthz"
```

Expected HTTP 200.

## Environment/secrets

Do not place production secrets in the ZIP.

Use Cloud Run environment variables and Secret Manager for:

- `DATABASE_URL`
- `DIRECTUS_URL`
- `DIRECTUS_TOKEN`

Directus remains optional and must remain fail-closed when not configured.

## Important deployment rule

This package is a Cloud Run **preview/warm-up deployment artifact**. Do not treat a successful container build as proof of media playback.

Phase 3 verification must prove:

1. health endpoint returns 200;
2. frontend loads;
3. `/app/ajn-network` loads;
4. AJN FILES selector works;
5. CLASSIC TV selector works;
6. ARCHIVE NEWS selector works;
7. exactly one `<video>` exists;
8. exactly one global `<audio>` exists;
9. Classic deterministic schedule resolves;
10. Archive/News playback reaches real `playing`;
11. HLS cleanup follows `stopLoad -> detachMedia -> destroy -> nullify`;
12. persistence remains ID-only and versioned;
13. no secrets are present;
14. no duplicate player pipeline is introduced.

If any gate fails, stop and diagnose before production promotion.
