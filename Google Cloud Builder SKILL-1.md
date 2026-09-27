---
name: ajn-google-cloud-builder
description: >
  Authoritative Google Cloud Builder skill for the AJN Cloud TV & Broadcast
  Matrix. Controls Google Cloud packaging, build, verification, deployment
  readiness, security, and GitHub authorization. Default operating state is
  NO-DEPLOY until explicit deployment authorization is granted by the user.
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

### GitHub authorization state

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

# 3. DEFAULT OPERATING MODE — NO-DEPLOY MODE

## MANDATORY DEFAULT

Every new Google Builder session starts in:

```text
NO-DEPLOY MODE = ON
```

No deployment is permitted unless the user explicitly changes the deployment
authorization state.

### NO-DEPLOY MODE permits

```text
✓ inspect source
✓ audit source
✓ correct source
✓ install dependencies
✓ regenerate lockfiles
✓ typecheck
✓ production build
✓ Docker build
✓ run local container
✓ curl local endpoints
✓ browser verification
✓ inspect Cloud configuration
✓ prepare deployment files
✓ validate Cloud Build configuration
✓ calculate checksums
✓ produce release evidence
```

### NO-DEPLOY MODE prohibits

```text
✗ gcloud run deploy
✗ gcloud run services update
✗ gcloud run services replace
✗ gcloud builds submit
✗ Artifact Registry image push
✗ Cloud Run service creation
✗ Cloud Run revision publication
✗ production traffic migration
✗ domain mapping
✗ DNS changes
✗ production environment changes
✗ Secret Manager changes
✗ production database migrations
✗ GitHub push
✗ GitHub pull/clone/fetch
```

### Critical distinction

A command that **builds an image locally** is permitted.

A command that **publishes an image to Artifact Registry** is not permitted.

A command that **validates `cloudbuild.yaml` locally** is permitted.

A command that **executes `gcloud builds submit`** is not permitted in
NO-DEPLOY MODE because it can publish build artifacts.

A command that **queries existing Cloud resources read-only** may be permitted
when needed for verification.

No mutation of Google Cloud resources is permitted.

---

# 4. DEPLOYMENT AUTHORIZATION GATE

Deployment requires an explicit user instruction.

Examples of authorization:

```text
Deploy this to Cloud Run now.
```

or:

```text
I authorize the Google Cloud deployment.
```

Before deployment, Builder must report:

```text
DEPLOYMENT AUTHORIZATION REQUESTED
```

and verify:

```text
Phase 1 PASS
Phase 2 PASS
Phase 3 PASS
Security PASS
Build PASS
Docker PASS
No unresolved blockers
```

If any gate is not PASS:

```text
DEPLOYMENT BLOCKED
```

Do not deploy.

### Never infer deployment authorization from

```text
build this
test this
prepare this
make this Cloud-ready
create the Docker image
check Cloud Run
get this ready for Google
```

Those requests do NOT authorize deployment.

---

# 5. OPERATING STATES

The skill uses explicit states:

```text
STATE 0
NO-DEPLOY / GITHUB-LOCKED
        ↓
STATE 1
BUILD-ONLY
        ↓
STATE 2
VERIFICATION
        ↓
STATE 3
DEPLOY AUTHORIZED
        ↓
STATE 4
DEPLOYMENT
```

Default:

```text
NO-DEPLOY / GITHUB-LOCKED
```

### State transition rule

Only explicit user authorization can transition:

```text
NO-DEPLOY
      ↓
DEPLOY AUTHORIZED
```

A successful build does not transition the state.

A successful Docker build does not transition the state.

A successful local health check does not transition the state.

A successful Cloud Build configuration validation does not transition the
state.

---

# 6. OPERATING SEQUENCE

Every task follows:

```text
PHASE 1 — INVESTIGATION
        ↓
PHASE 2 — IMPLEMENTATION / CORRECTION
        ↓
PHASE 3 — VERIFICATION
        ↓
APPROVAL GATE
        ↓
OPTIONAL DEPLOYMENT
```

Never skip Phase 1.

Never report PASS without evidence.

Never report deployment readiness based solely on source inspection.

Never deploy before explicit authorization.

---

# 7. PHASE 1 — INVESTIGATION

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

# 8. GOOGLE PACKAGE REQUIREMENTS

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

# 9. GOOGLE CLOUD TARGET ARCHITECTURE

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

# 10. AJN PLAYBACK ARCHITECTURE

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

# 11. DOMAIN CONTRACTS

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

# 12. HLS MEMORY-SAFETY CONTRACT

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

# 13. CLASSIC TV SCHEDULING

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

# 14. MEDIA IDENTITY

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

# 15. PERSISTENCE CONTRACT

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

# 16. GOOGLE CLOUD RUNTIME CONTRACT

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

# 17. DEPENDENCY POLICY

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

# 18. BUILD GATES

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

These operations are permitted in NO-DEPLOY MODE.

---

# 19. DOCKER GATE

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

All of these are permitted in NO-DEPLOY MODE.

---

# 20. CLOUD BUILD / CLOUD RUN DEPLOYMENT GATE

## NO-DEPLOY MODE RULE

Do NOT execute:

```bash
gcloud builds submit
```

Do NOT execute:

```bash
gcloud run deploy
```

Do NOT execute any Cloud Run mutation command.

Instead, validate the deployment configuration locally where possible.

The deployment command may be documented, checked, or prepared, but must not
be executed while:

```text
NO-DEPLOY MODE = ON
```

### Deployment command

The eventual deployment command is:

```bash
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=_REGION=us-west1,_REPOSITORY=ajn,_IMAGE=ajn-cloud-tv,_SERVICE=ajn-cloud-tv
```

This command is **documentation until explicit deployment authorization**.

After deployment authorization, execute it only after all gates in Section 24
have passed.

---

# 21. READ-ONLY CLOUD INSPECTION

Read-only Cloud inspection is permitted when required.

Examples:

```bash
gcloud config get-value project
```

```bash
gcloud run services describe SERVICE \
  --region=REGION
```

These commands must not be used to mutate resources.

If a command can create, update, replace, delete, publish, migrate, or route
traffic, it is prohibited in NO-DEPLOY MODE.

When uncertain:

```text
STOP
```

and classify the command before execution.

---

# 22. MEDIA VERIFICATION

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

# 23. SECURITY GATE

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

# 24. ANTI-PATTERN GATE

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

# 25. TELEMETRY RULE

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

# 26. NO-GUESSING RULE

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

# 27. GITHUB SAFETY GATE

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

GitHub authorization does NOT automatically authorize Google Cloud deployment.

They are separate approvals.

---

# 28. DEPLOYMENT SAFETY GATE

Before any actual Cloud Run deployment, the report must explicitly contain:

```text
NO-DEPLOY MODE:
DISABLED

GOOGLE CLOUD DEPLOYMENT:
AUTHORIZED BY USER

PHASE 1:
PASS

PHASE 2:
PASS

PHASE 3:
PASS

SECURITY:
PASS

BUILD:
PASS

DOCKER:
PASS

BLOCKERS:
NONE
```

If any field is missing or not PASS:

```text
DEPLOYMENT BLOCKED
```

No deployment command may execute.

---

# 29. FINAL PASS CRITERIA

Report:

```text
SAFE TO DEPLOY
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
- no unresolved blockers;
- explicit user deployment authorization.

Otherwise:

```text
NOT SAFE TO DEPLOY
```

with the exact blocker.

A build PASS without deployment authorization means:

```text
SAFE TO BUILD
NOT AUTHORIZED TO DEPLOY
```

---

# 30. REQUIRED REPORT FORMAT

Every significant Google Builder task concludes with:

## TL;DR

Two to three sentences.

## Operating Mode

Explicitly state:

```text
NO-DEPLOY MODE: ON/OFF
GITHUB: LOCKED/AUTHORIZED
```

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

## Deployment Status

Explicitly state:

```text
Cloud Build submitted: NO/YES
Artifact Registry modified: NO/YES
Cloud Run deployed: NO/YES
Production traffic changed: NO/YES
```

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

# 31. DOCUMENTATION REFERENCES

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

# 32. CORE COMMAND PALETTE

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

This does NOT authorize deployment.

### Prepare

```text
prepare google deployment
```

Validate Dockerfile, Cloud Build configuration, environment contract, health
configuration, and deployment documentation.

This does NOT deploy.

### Deploy

```text
deploy google
```

Requires explicit user authorization.

If authorization is absent:

```text
DEPLOYMENT BLOCKED — NO-DEPLOY MODE
```

### Verify

```text
verify google
```

Run Cloud Run health, frontend, API, player, media, persistence, security,
and telemetry verification when a deployed environment is explicitly
authorized.

### GitHub

```text
push github
```

Requires separate explicit GitHub authorization and a prior Google verification
PASS.

---

# 33. FINAL PRINCIPLE

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
DEPLOY
   ↓
OPTIONAL GITHUB PUSH
```

Never:

```text
DEPLOY
   ↓
DISCOVER
   ↓
FIX
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

Cloud Run deployment is not authorized by default.

Production is never considered safe merely because the container builds.

Playback, memory safety, persistence, security, and real telemetry must all be
verified.

**Default state is always:**

```text
NO-DEPLOY MODE = ON
GITHUB = LOCKED
```

Only explicit user authorization may change either state.