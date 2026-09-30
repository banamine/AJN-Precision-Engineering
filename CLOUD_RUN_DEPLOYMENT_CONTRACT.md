# Cloud Run Deployment Contract
One Cloud Run service: Express API + built SPA in one process.
- Node 22, npm. The Docker image uses `npm ci --ignore-scripts --no-audit --no-fund`, which skips Puppeteer's Chrome download during the image build; `ajn-deploy.yml` uses plain `npm ci --no-audit --no-fund` so the production playback gate has Chrome available.
- Build: `npm run build`  (vite build + esbuild server.ts -> dist/server.cjs)
- Start: `node dist/server.cjs` (NODE_ENV=production, PORT from Cloud Run, default 8080, bound to 0.0.0.0)
- Image: see Dockerfile (multi-stage, node:22-bookworm-slim). Deploy: ajn-deploy.yml
  runs `gcloud run deploy --source .` (Cloud Run builds the Dockerfile from source).
- CI artifact: `ajn-production-dist` is produced by ajn-ci.yml for the integration job's
  playback/API/visual checks. ajn-deploy.yml does not download or deploy that artifact;
  it checks out the exact CI commit and performs its own `npm ci` + `npm run build` before
  deploying source to Cloud Run.
- State is in-memory only. No database. No secrets are stored in the repo or image.
- Routes: `/api/*` JSON (unknown /api paths return JSON 404); everything else serves dist/index.html.
- Media proxy: `/api/archive/proxy` must never return one response larger than 32 MiB
  (Cloud Run HTTP/1 limit). It serves bounded 206 slices of at most 8 MiB.
- CI gates (ajn-ci.yml: lint, pure-regressions, integration) must pass on main before deploy.

**Open handoff items**
- manifest entries that fail real playback; candidate count varies by run.
- `V1_FILE_SHA256.txt` still lists the old `test-429.ts` path.
- `AJN_FULL_REBUILD_MANIFEST.json` still lists the old `test-429.ts` path.
