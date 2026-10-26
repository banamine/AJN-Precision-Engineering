---
name: ajn-report-format
description: Standard format for AJN test, review and fix reports returned to the owner — TL;DR, verified vs assumed, evidence, files changed, verify commands, next action.
---

# AJN report format

```
## TL;DR
2–3 sentences: what was done, result, what's still open.

## Environment
URL · commit SHA · date/time UTC · browser/Node version

## Findings / Changes
| # | Area | What | Evidence | Status |
Status: VERIFIED (seen) · ASSUMED (not seen) · FAILED · UNKNOWN

## Files changed
path:line — one-line reason (none if review only)

## Verify yourself
exact commands / clicks + expected output

## Next action / Decision needed
one item
```

Rules: never claim "production ready" or "fixed" without the evidence column filled. Keep it short; link screenshots rather than describing them at length.
