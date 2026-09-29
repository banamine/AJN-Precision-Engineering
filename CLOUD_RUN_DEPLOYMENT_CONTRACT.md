# Cloud Run Deployment Contract
One Cloud Run service: Express API + built SPA in one process.
- Node 22, npm. Install: `npm ci --ignore-scripts --no-audit --no-fund`
- Build: `npm run build`  (vite build + esbuild server.ts -> dist/server.cjs)
- Start: `node dist/server.cjs` (NODE_ENV=production, PORT from Cloud Run, default 8080, bound to 0.0.0.0)
- Image: see Dockerfile (multi-stage, node:22-bookworm-slim). Deploy: ajn-deploy.yml
  runs `gcloud run deploy --source .` (Cloud Run builds the Dockerfile from source).
- State is in-memory only. No database. No secrets are stored in the repo or image.
- Routes: `/api/*` JSON (unknown /api paths return JSON 404); everything else serves dist/index.html.
- Media proxy: `/api/archive/proxy` must never return one response larger than 32 MiB
  (Cloud Run HTTP/1 limit). It serves bounded 206 slices of at most 8 MiB.
- CI gates (ajn-ci.yml: lint, pure-regressions, integration) must pass on main before deploy.
