---
name: ajn-archive-outage
description: Investigate Archive.org availability problems in AJN without misclassifying individual media, increasing retry load, or weakening proxy safety.
---

# AJN Archive outage response

Use this procedure when unrelated Archive items or storage hosts fail together, the proxy reports repeated resets/timeouts, or Archive's official status posts report an incident.

## Recognize the pattern

- Look for resets, DNS errors, connection/header timeouts, `fetch failed`, or repeated 5xx responses across different Archive identifiers.
- Compare the server's `/api/archive/status` result with the existing proxy diagnostics.
- Check Archive's official status posts/pages only if a current external lookup is needed; report what was actually observed and when. Do not infer an Archive incident from one broken item.
- Distinguish item-specific 400/403/404/410/422 responses from site/network failures.

## What to do

1. Start with `/api/archive/status` and the affected request's existing diagnostics.
2. If independent confirmation is necessary and the owner authorizes it, make **one** lightweight request to `https://archive.org/` (for example, `HEAD`). Use a descriptive User-Agent. Do not retry it.
3. Stop Archive-dependent probing or census work on 429, any `Retry-After`, or 5xx. Respect the retry window and request budget.
4. Record the timestamp, status, request count, and broad error class in the report. Never include captions, transcripts, secrets, or unnecessary item titles.
5. Keep retry/backoff and URL-validation protections intact. Do not “fix” timeouts by weakening SSRF checks or widening retries.
6. Do not mark, park, skip, or defer individual items solely because the site is down or unreachable. Do not write outage-period failures to the per-item failure cache.
7. Keep non-Archive sources available; do not silently substitute another programming domain.

## Resume checklist

- `/api/archive/status` has returned to `ok` after the configured two successful probes.
- The server can reach both the Archive target and the control target as reported by the state.
- Retry only the specific interrupted workflow, within its existing request budget and spacing.
- Verify the workflow with its established focused tests before reporting recovery.
- Record remaining uncertainty; do not claim Archive-wide recovery based on a single item.
