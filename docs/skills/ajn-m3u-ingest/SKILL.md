---
name: ajn-m3u-ingest
description: Diagnose and verify M3U/M3U8 playlist ingestion into AJN MediaAssets — EXTINF parsing, group-title/tvg-id, smart clustering of mixed playlists, encoding, and dead-entry reporting.
---

# AJN M3U ingest

## Parse rules
- `#EXTM3U` header optional; tolerate BOM and CRLF.
- `#EXTINF:<dur> key="val" ...,<title>` then URL line. Keys: `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`.
- Duration `-1` = live. Relative URLs resolve against the playlist URL.
- Percent-encode spaces/parentheses per segment (e.g. `%20%281%29`); don't double-encode.

## Clustering mixed playlists
Split into shows by `group-title`, then `tvg-name`, then filename patterns (`S01E02`, `1x02`, dates). Keep original order inside a show.

## Checks
- Count lines vs. parsed entries; report dropped lines with reason.
- Sample 5 URLs with `curl -sI` / `Range: bytes=0-1023`; record status + content-type.
- Duplicates by URL → keep first, report count.

## Test source
`https://archive.org/download/daily-highlights/m3u_split_shows_2026-08-05%20%281%29/split_shows/`

## Output
`playlist | entries | parsed | dropped(reason) | dupes | sample status codes`.
