---
name: ajn-expert-search
description: Expert Archive.org and in-app catalog search for AJN — advanced-search query syntax, field filters, finding browser-safe MP4 derivatives, excluding restricted items, and building temporary playlists from results.
---

# AJN expert search

## Archive.org query building
Use the advanced search API (`https://archive.org/advancedsearch.php?q=...&fl[]=identifier&fl[]=title&fl[]=mediatype&rows=50&output=json`) or the scrape API for large sets.

Useful fields:
- `mediatype:movies` / `mediatype:audio`
- `collection:(daily-highlights)` , `uploader:...`, `creator:"..."`
- `title:(term)` , `subject:(term)` , `date:[2026-01-01 TO 2026-12-31]`
- Boolean `AND OR NOT`, phrases in quotes, wildcards `term*`.
- Exclude loans/restricted: `AND NOT collection:(inlibrary OR printdisabled)` and later drop files with `private: "true"` in metadata.

Example: `collection:(daily-highlights) AND mediatype:movies AND title:(news) AND date:[2026-10-01 TO *]`

## From item to playable URL
1. `GET https://archive.org/metadata/{identifier}`.
2. Choose files where `format` contains `h.264` or `MPEG4` and name ends `.mp4`; prefer the derivative over a huge original.
3. Skip files with `private: true`.
4. Build `https://archive.org/download/{identifier}/{encodeURIComponent each path segment}` — encode segments individually; nested folders must keep their `/`.
5. Play through `/api/archive/proxy` (bounded 206), never a full GET.

## Rate and safety
- Small `rows`, page with cursors; stop on 429/5xx/`Retry-After` (see `ajn-archive-outage`).
- Never weaken `isUrlSafe` to make a search work.

## In-app search checks
- Query submits on Enter and button; results replace stale results (no flash of old list).
- Suggestions/history don't scroll the page.
- Empty result shows "No results for X", not a spinner forever.

## Output
List: query used, total hits, top N identifiers with chosen MP4 file + size, skipped items with reason.
