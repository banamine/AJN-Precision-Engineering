---
name: ajn-google-cloud-builder
description: >
  Authoritative Google Cloud Builder skill for the AJN Cloud TV & Broadcast
  Matrix. Controls Google Cloud packaging, build, Cloud Run preparation,
  verification, security, deployment readiness, and GitHub authorization.
  The uploaded Google Cloud package is the source of truth until explicit
  authorization is given to use GitHub.
---

# AJN GOOGLE CLOUD BUILDER SKILL

## 1. PURPOSE

This skill governs all AJN Cloud TV & Broadcast Matrix work performed for
Google Cloud Builder, Google Cloud Build, Artifact Registry, and Cloud Run.

The objective is to take the verified AJN application and produce a clean,
repeatable Google Cloud deployment artifact without introducing architecture
drift.

Google Cloud is the **build and verification authority** for the deployment
package.

GitHub is a later source-control destination and is NOT automatically a source
for application code.

---

# 2. SOURCE-OF-TRUTH RULE

Until explicitly authorized by the user:

```text
UPLOADED GOOGLE ZIP
        ↓
     SOURCE
        ↓
GOOGLE BUILDER
        ↓
BUILD / VERIFY
```

Do NOT automatically use:

```text
GitHub
Git clone
Git pull
GitHub Actions
GitHub repository state
```

The latest explicitly supplied Google Cloud ZIP is authoritative.

### GitHub authorization states

```text
GITHUB = LOCKED
```

means:

- no clone;
- no pull;
- no fetch;
- no merge;
- no push;
- no branch modification;
- no GitHub source substitution.

Only the user can change this state.

Never infer authorization from a build request.

---

# 3. OPERATING MODE

Every task follows:

```text
PHASE 1 — INVESTIGATION
        ↓
PHASE 2 — IMPLEMENTATION / CORRECTION
        ↓
PHASE 3 — VERIFICATION
        ↓
APPROVAL GATE
```

Never skip Phase 1.

Never report PASS without evidence.

Never report deployment readiness based solely on source inspection.

---

# 4. PHASE 1 — INVESTIGATION

Before modifying the application:

## Inspect project structure

```bash
find . -maxdepth 3 -type f | sort
```

## Inspect package manifests

```bash
cat package.json
cat pnpm-workspace.yaml
find artifacts -name package.json -print
```

## Inspect Google deployment configuration

```bash
cat Dockerfile
cat cloudbuild.yaml
cat .dockerignore
cat .env.example
```

## Inspect application entry points

```bash
find artifacts/api-server -maxdepth 3 -type f | sort
find artifacts/tv-stream-guide/src -maxdepth 2 -type f | sort
```

## Inspect player ownership

```bash
grep -Rni "<video" artifacts/tv-stream-guide/src
grep -Rni "<audio" artifacts/tv-stream-guide/src
grep -Rni "useAuthoritativePlayback" artifacts/tv-stream-guide/src
```

## Inspect Replit contamination

```bash
find . -iname '*replit*'
find . -type d \( -name '.git' -o -name '.agents' -o -name '.config' \)
```

Any unexpected Replit artifact must be investigated before PASS.

---

# 5. GOOGLE PACKAGE REQUIREMENTS

A Google Cloud drop-in package must be provider-neutral at application level
and Google-specific only at the deployment boundary.

Required deployment files may include:

```text
Dockerfile
cloudbuild.yaml
.dockerignore
.env.example
GOOGLE-BUILDER-INSTALL.md
GOOGLE-CLOUD-BASELINE.md
README-GOOGLE-CLOUD.md
```

Do not include:

```text
.git/
.replit
replit.md
.replit-artifact/
Replit agent state
Replit-only deployment configuration
private credentials
service-account JSON
private keys
```

---

# 6. GOOGLE CLOUD TARGET ARCHITECTURE

The initial target is one Cloud Run service:

```text
Google Cloud
    │
    ▼
Cloud Run
    │
    └── Node.js / Express
          ├── /api/*
          ├── health / diagnostics
          └── React/Vite static application
                  │
                  ▼
             AjnMediaCenter
```

Do not introduce multiple application servers unless explicitly authorized.

Do not introduce a second playback service merely to support a domain.

---

# 7. AJN PLAYBACK ARCHITECTURE

The authoritative playback architecture is:

```text
AjnMediaCenter
    │
    ├── ONE <video>
    ├── ONE global <audio>
    │
    ├── AJN FILES
    ├── CLASSIC TV
    └── ARCHIVE NEWS
```

All three domains feed the same authoritative player.

### Prohibited

```text
Second video
Second HLS pipeline
Second global audio
Separate News player
Separate Classic player
Separate AJN Files player
Duplicate playback route
Hidden conditional player
```

Check:

```bash
grep -Rni "<video" artifacts/tv-stream-guide/src
grep -Rni "<audio" artifacts/tv-stream-guide/src
```

Investigate every result.

---

# 8. DOMAIN CONTRACTS

The three primary in-page domains are:

```text
AJN FILES
CLASSIC TV
ARCHIVE NEWS
```

They remain separate source/content domains while sharing the authoritative
player.

### AJN FILES

Owns AJN file/media selection.

### CLASSIC TV

Owns:

- Classic TV catalog;
- show/episode selection;
- Guide;
- Mini EPG;
- deterministic schedule;
- duration-backed playback eligibility;
- last-channel persistence.

### ARCHIVE NEWS

Owns:

- Archive News catalog;
- broadcaster/source selection;
- verified source resolution;
- News playback identity.

Do not silently cross-fallback between these domains.

---

# 9. HLS MEMORY-SAFETY CONTRACT

HLS teardown is mandatory:

```text
stopLoad()
    ↓
detachMedia()
    ↓
destroy()
    ↓
nullify
```

Search:

```bash
grep -Rni "stopLoad\|detachMedia\|destroy" artifacts/tv-stream-guide/src
```

Never remove lifecycle cleanup to solve a build issue.

Never introduce another HLS instance without an explicit architecture review.

---

# 10. CLASSIC TV SCHEDULING

Classic TV scheduling must remain deterministic.

Eligibility requires:

```text
PLAYABLE
+
HTTPS
+
video/mp4
+
positive durationSeconds
```

Do not invent durations.

Do not use random episode selection.

Do not use `Math.random()` for scheduling.

Preserve:

```text
linear-schedule.ts
broadcast-domain-contracts.ts
classic-guide.ts
```

where applicable.

The deterministic schedule is separate from the player implementation.

---

# 11. MEDIA IDENTITY

Never change canonical media identity merely to improve presentation.

Preserve:

```text
source URL
original filename
source ID
canonical media ID
playback identity
deduplication identity
```

Display normalization must remain display-only.

Example:

```text
VIDEO - 20260911_Fri_Alex-Hr1
```

may display as:

```text
2026-09-11 (Fri) - Alex Hr 1
```

but must NOT rename the underlying source identity.

---

# 12. PERSISTENCE CONTRACT

Preserve:

```text
ajn-network.selection.v1
```

Persistence should use stable identifiers/contracts.

Do not persist raw media URLs unless the established contract explicitly requires
them.

Verify that AJN, Classic, and News selections merge without overwriting one
another.

---

# 13. GOOGLE CLOUD RUNTIME CONTRACT

Cloud Run requires:

```text
PORT
0.0.0.0
```

The server must bind to the Cloud Run-provided port.

Check:

```bash
grep -Rni "0.0.0.0\|process.env.PORT" artifacts/api-server
```

Static frontend serving must use the production build.

Example deployment environment:

```text
NODE_ENV=production
PORT=8080
BASE_PATH=/
STATIC_ROOT=/app/artifacts/tv-stream-guide/dist/public
```

Do not hardcode credentials.

---

# 14. DEPENDENCY POLICY

Google deployment manifests must not require Replit-specific runtime
packages.

Known Replit-only packages include:

```text
@replit/connectors-sdk
@replit/vite-plugin-cartographer
@replit/vite-plugin-dev-banner
@replit/vite-plugin-runtime-error-modal
```

Search:

```bash
grep -Rni "replit" \
  package.json \
  pnpm-workspace.yaml \
  artifacts/*/package.json
```

After manifest correction, regenerate the lockfile.

Never manually delete random lockfile records.

Use:

```bash
corepack enable
corepack prepare pnpm@10.26.1 --activate
pnpm install --no-frozen-lockfile
```

Then:

```bash
grep -ni "replit" pnpm-lock.yaml
```

Expected:

```text
No active application dependency on Replit.
```

---

# 15. BUILD GATES

A Google package is not PASS until:

```bash
pnpm install --no-frozen-lockfile
```

passes.

Then:

```bash
pnpm exec tsc --build --force
```

must pass.

Then:

```bash
PORT=8080 BASE_PATH=/ pnpm run build
```

must pass.

Capture actual output.

Do not replace errors with assumptions.

---

# 16. DOCKER GATE

Build:

```bash
docker build -t ajn-cloud-tv:local .
```

Expected:

```text
BUILD SUCCESS
```

Run:

```bash
docker run --rm \
  -p 8080:8080 \
  -e PORT=8080 \
  -e BASE_PATH=/ \
  -e STATIC_ROOT=/app/artifacts/tv-stream-guide/dist/public \
  ajn-cloud-tv:local
```

Test:

```bash
curl -i http://127.0.0.1:8080/api/healthz
```

Expected:

```text
HTTP 200
```

Test frontend:

```bash
curl -I http://127.0.0.1:8080/
```

Expected:

```text
HTTP 200
```

---

# 17. CLOUD RUN GATE

After local Docker verification:

```bash
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=_REGION=us-west1,_REPOSITORY=ajn,_IMAGE=ajn-cloud-tv,_SERVICE=ajn-cloud-tv
```

Then:

```bash
gcloud run services describe ajn-cloud-tv \
  --region=us-west1 \
  --format='value(status.url)'
```

Health:

```bash
curl -i "$(gcloud run services describe ajn-cloud-tv \
  --region=us-west1 \
  --format='value(status.url)')/api/healthz"
```

Expected:

```text
HTTP 200
```

A successful Cloud Run deployment is NOT proof of successful media playback.

---

# 18. MEDIA VERIFICATION

Phase 3 must test:

```text
AJN FILES
→ CLASSIC TV
→ ARCHIVE NEWS
→ CLASSIC TV
→ AJN FILES
```

Capture:

- domain;
- canonical media ID;
- source ID;
- playback state;
- video count;
- audio count;
- HLS lifecycle state;
- persistence state;
- console errors;
- server errors.

Required:

```text
videoCount = 1
audioCount = 1
```

Do not accept a test that only proves the page rendered.

Playback must reach the real playback state where applicable.

---

# 19. SECURITY GATE

Search:

```bash
grep -RniE \
"AKIA[0-9A-Z]{16}|BEGIN PRIVATE KEY|PRIVATE KEY|password=|secret=|api[_-]?key=" \
. \
--exclude-dir=node_modules \
--exclude-dir=.git \
--exclude-dir=dist
```

Also:

```bash
find . -type f \( \
-name "*.pem" -o \
-name "*.key" -o \
-name "*.p12" -o \
-name "*.pfx" -o \
-name "*service-account*.json" \
\)
```

Expected:

```text
No production secrets.
No private keys.
No service-account credentials.
```

Use Secret Manager / Cloud Run configuration for production secrets.

---

# 20. ANTI-PATTERN GATE

Run:

```bash
grep -RniE \
"Math\.random|document\.getElementById|innerHTML|http://|<video|<audio|@replit|REPL_ID|REPLIT" \
artifacts \
--exclude-dir=node_modules \
--exclude-dir=dist
```

Investigate every result.

Immediately flag:

- duplicate video pipelines;
- duplicate audio pipelines;
- fake telemetry;
- hardcoded telemetry;
- unsafe DOM access;
- silent fallbacks;
- exposed secrets;
- Replit runtime dependencies;
- unnecessary absolute/relative API URL behavior;
- arbitrary media identity changes.

---

# 21. TELEMETRY RULE

Telemetry must be real.

Prohibited:

```javascript
Math.random()
```

for health, latency, playback, uptime, buffer, or diagnostic metrics.

Prohibited:

```text
hardcoded "healthy"
fake duration
fake playback state
fake stream status
```

Diagnostics must derive from actual runtime state.

---

# 22. NO-GUESSING RULE

If implementation intent is ambiguous:

```text
STOP
```

Do not invent:

- endpoints;
- environment variables;
- media URLs;
- database schemas;
- authentication;
- playback fallbacks;
- source IDs;
- schedule behavior;
- deployment topology.

Report:

```text
WHAT IS UNCLEAR
WHY IT MATTERS
EVIDENCE
QUESTION REQUIRING DECISION
```

---

# 23. GITHUB SAFETY GATE

GitHub remains locked unless the user explicitly authorizes it.

Before any GitHub operation, display:

```text
GITHUB AUTHORIZATION REQUIRED
```

Do not proceed without explicit authorization.

Even after authorization:

```text
LOCAL GOOGLE BUILD
        ↓
PHASE 3 PASS
        ↓
USER APPROVAL
        ↓
GITHUB PUSH
```

Never push a package merely because the build succeeds.

---

# 24. FINAL PASS CRITERIA

Report:

```text
SAFE TO PUSH
```

ONLY when all required gates pass:

- source integrity;
- Google package structure;
- no Replit deployment contamination;
- dependencies resolve;
- lockfile clean;
- TypeScript PASS;
- Vite production build PASS;
- Docker build PASS;
- local health PASS;
- Cloud Run health PASS when deployed;
- frontend loads;
- one video;
- one audio;
- AJN Files PASS;
- Classic TV PASS;
- Archive News PASS;
- deterministic Classic scheduling PASS;
- HLS cleanup PASS;
- persistence PASS;
- domain transition PASS;
- security PASS;
- telemetry PASS;
- no unresolved blockers.

Otherwise:

```text
NOT SAFE TO PUSH
```

with the exact blocker.

---

# 25. REQUIRED REPORT FORMAT

Every significant Google Builder task concludes with:

## TL;DR

Two to three sentences.

## Phase 1 — Investigation

Actual evidence.

## Phase 2 — Changes

Exact files and changes.

## Phase 3 — Verification

Commands and actual results.

## Architecture

Confirm:

```text
ONE VIDEO
ONE AUDIO
ONE AUTHORITATIVE PLAYER
THREE CONTENT DOMAINS
```

## Security

Secret/dependency audit.

## GitHub Status

Explicitly state:

```text
GitHub pull: NO/YES
GitHub push: NO/YES
```

## Remaining Blockers

List none or exact blockers.

## Decision Point

State exactly what authorization or next action is required.

---

# 26. DOCUMENTATION REFERENCES

Use these AJN documents when present:

```text
SKILL.md
known-bugs.md
hls-cleanup-checklist.md
archive-org-api.md
PLAYBACK_GUIDE.md
PRODUCTION_SUMMARY.md
wireframe_spec.md
end-to-end-workflow.md
```

Google-specific documentation:

```text
GOOGLE-BUILDER-INSTALL.md
GOOGLE-CLOUD-BASELINE.md
```

When code evidence is available, cite:

```text
file path
line number
command output
```

Do not invent line numbers.

---

# 27. CORE COMMAND PALETTE

### Audit

```text
audit [component]
```

Run the applicable anti-pattern, dependency, security, architecture, and
runtime checks.

### Fix

```text
fix [bug]
```

Run Phase 1 → correction → Phase 3.

### Build

```text
build google
```

Run dependency, typecheck, production build, Docker, and health gates.

### Deploy

```text
deploy google
```

Only after build PASS. Deploy to the authorized Google Cloud project.

### Verify

```text
verify google
```

Run Cloud Run health, frontend, API, player, media, persistence, security,
and telemetry verification.

### GitHub

```text
push github
```

This command requires explicit authorization and a prior Google verification
PASS.

---

# 28. FINAL PRINCIPLE

The order is:

```text
EVIDENCE
   ↓
CORRECT
   ↓
BUILD
   ↓
VERIFY
   ↓
APPROVE
   ↓
PUSH
```

Never:

```text
PUSH
   ↓
DISCOVER
   ↓
FIX
```

Google Builder is the controlled verification environment.

GitHub is not the source of truth unless explicitly authorized.

Production is never considered safe merely because the container builds.
Playback, memory safety, persistence, security, and real telemetry must all be
verified.