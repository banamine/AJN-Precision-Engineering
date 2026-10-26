---
name: ajn-change-review
description: Evidence-gated review of an AJN code change or PR before merge — scope, doctrine violations, duplicates, protected core, tests, and a pass/fail verdict with verify commands.
---

# AJN change review

## Inputs
`git diff main...HEAD --stat` and full diff. Read every changed file, not just the summary.

## Checklist
- [ ] Scope: only files needed for the stated fix. Flag drive-by edits and repo-root clutter.
- [ ] No new parallel proxy/guide/store/pipeline.
- [ ] Protected core touched? Is it justified by evidence?
- [ ] No fake telemetry, no silent fallback, no hardcoded test URLs in prod code.
- [ ] Proxy routes: `isUrlSafe`, bounded 206, header propagation, abort on close.
- [ ] Types: no new `any`; unguarded DOM lookups (`getElementById(...)!`).
- [ ] No secrets, no relative API base that breaks on GitHub Pages/Cloud Run.
- [ ] `npm ci && npm run build && npm test` (and lint/typecheck if present) — paste results.
- [ ] Node 22 parity with CI; `process.env.PORT` honored.

## Verdict format
`APPROVE | CHANGES REQUESTED | BLOCKED (no evidence)` then findings ranked by severity with file:line, and a Phase-3 verify list the owner can run.
