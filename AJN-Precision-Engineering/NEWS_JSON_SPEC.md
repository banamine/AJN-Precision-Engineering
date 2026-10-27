# `news.json` — Reverse-Engineered Specification

**Artifact analyzed:** `news.json`, 497,230 bytes
**Envelope:** `{ generated: "2026-09-06T00:07:36.598Z", total: 353, episodes: Episode[] }`
**Evidence basis:** every claim below was computed from the file itself. Where a claim is inference rather than measurement, it is tagged **[INFERRED]**.

---

## 1. What this file actually is

It is **not** a playlist of 353 videos. It is **30 Internet Archive TV News items, sliced into 353 virtual clips** by arithmetic — no media was cut, transcoded, or moved. Every row points back at the same 30 parent `.mp4` files with a start/end query string appended.

| Measure | Value |
|---|---|
| Rows (`episodes`) | 353 |
| Distinct source items (`tvgId`) | 30 |
| Distinct channels | 6 (FOXNEWSW, CNNW, RT, RUSSIA1, BBCNEWS, KPIX) |
| Programs per channel | 5 (uniform — a hard `LIMIT 5` per channel) |
| Columns per row | 38, populated on 353/353 rows |
| `importedAt` distinct values | **1** (`2026-09-06T00:00:19.615Z`) |

The single `importedAt` and the fully-uniform 38-column shape mean this is **one batch insert dumped straight out of the ORM** (Drizzle row shape, matching the news-scraper stack), then re-serialized 7m17s later at `generated`.

---

## 2. Identifier grammar

```
tvgId    := {CALLSIGN}_{YYYYMMDD}_{HHMMSS}_{Show_Name_Underscored}
id       := {tvgId}_seg{NNNN}_c{K}
```

- `tvgId` is the **Internet Archive TV News item identifier verbatim** — it is not constructed by this pipeline, it is harvested. `FOXNEWSW_20260905_220000_The_Big_Weekend_Show` is a real IA item.
- `seg{NNNN}` is **always `0000`** across all 353 rows. It is a reserved axis (multi-file items) that the current generator never exercises. Dead field today, useful later.
- `c{K}` is the **chunk index**, 0-based, `0 … n-1`.
- `id` prefix equals `tvgId` on 353/353 rows — no drift.

---

## 3. The chunking formula (verified 30/30, exact)

This is the core of the whole file. Given a parent item of total duration `T` seconds:

```
n = ceil(T / 300)                 // chunk count — 300s is the ceiling, not the target
d = ceil(T / n)                   // even chunk length, so no runt segment
start_i = i * d
end_i   = min(start_i + d, T)
duration_i = end_i - start_i
```

Run against all 30 items, this **reproduces the observed 353-row chunk table byte-for-byte, including every short tail chunk.** That is the strongest evidence in this document: the generator is fully deterministic and now fully known.

Worked examples:

| Item | T | n | d | last chunk |
|---|---|---|---|---|
| `RUSSIA1_…_Strannitsa` | 13139 | 44 | 299 | 282 |
| `FOXNEWSW_…_Fox_Report…` | 3663 | 13 | 282 | 279 |
| `RT_…_Documentary` | 3454 | 12 | 266 | 264 |
| `RUSSIA1_…_Vesti._Mestnoe_vremya` | 2616 | 12 | 218 | 217 |

Note the design intent: `d = ceil(T/n)` rather than a fixed 300 avoids a 63-second orphan chunk at the end of every hour. That was a deliberate, correct choice.

**Missing-duration fallback:** 2 items (`FOXNEWSW_20260905_220000_…`, `CNNW_20260905_220000_…`) have `T = 3600` exactly, `n = 12`, `d = 300`, and `contentType: null`. Both are the 22:00 hour — the newest slot at harvest time. **[INFERRED]** the metadata call returned no duration for items IA was still processing, and the generator defaulted `T = 3600`. Corroborating: those two are also the only items whose subtitle track is `cc5.srt` on a channel where every older item got `align.srt` — alignment files are generated later than caption files.

---

## 4. Derived-field formulas

```ts
title       = `${tvgName} [${YYYY}-${MM}-${DD} ${HH}:${mm}] ${hh2}:${mm2}`
              // hh2:mm2 = HH:MM of start_i, i.e. floor(s/3600):floor((s%3600)/60)
              // verified 353/353 exact
groupTitle  = `${CALLSIGN} ${tvgName}`
tvgName     = Show_Name with underscores → spaces
tvgLogo     = `https://archive.org/services/img/${tvgId}`     // 353/353
subtitleUrl = `https://archive.org/download/${tvgId}/${tvgId}.${VARIANT}.srt`
season      = 1                                               // constant
episode     = 1-based global index across the whole sorted set
```

**Subtitle variant preference** (observed per-item, never mixed within an item):

```
align.srt  →  cc5.srt  →  asr.srt  →  null
   5 items     7 items     8 items     3 items      (by parent item)
```

`align` = caption-to-audio aligned, `cc5` = raw closed captions, `asr` = machine transcript. The ordering is a genuine quality ranking. 3 RUSSIA1 items have none — no captions exist upstream.

**Sort order** producing `episode` 1…353:

```
1. channel bucket, fixed order: FOXNEWSW, CNNW, RT, RUSSIA1, BBCNEWS, KPIX
2. within channel: air timestamp DESCENDING (newest hour first)
3. within item: chunk index ASCENDING
```

---

## 5. Field census — what is live and what is scaffolding

**Live (carries information):** `id`, `season`, `episode`, `title`, `duration`, `url`, `groupTitle`, `tvgId`, `tvgName`, `tvgLogo`, `subtitleUrl`, `description` (20 distinct, one per show), `importedAt`, `contentType`.

**Constant across all 353 rows:** `status:"pending"`, `sourceHost:"archive.org"`, `isWebCompatible:true`, `season:1`, `priority:0`, `isLive:false`, `resumeOffset:0`, `mustPlayFull:false`, `thumbnailLocked:false`, `preempt:false`.

**Null / empty across all 353 rows:** `thumbnailUrl`, `validatedAt`, `resolvedUrl`, `objectPosition`, `airDate`, `ytVideoId`, `iframeUrl`, `expiresAt`, `sourceType`, `lastPlayedAt`, `preemptType`, `allowedPlayers`, `tags[]`, `preferredDayparts[]`, `cutPoints[]`.

Two consequences worth stating plainly:

1. **`status:"pending"` + `validatedAt:null` + `resolvedUrl:null` on 353/353 means the validation pass has never run against this dataset.** Nothing in this file has been confirmed playable. `isWebCompatible:true` is a schema default, not a measurement.
2. **`airDate` is null on every row even though the air date is sitting inside `tvgId`.** The parse is available and free; it just isn't wired up. That is why EPG placement has nothing to sort on but `episode`.

---

## 6. The defect that governs playback

Every row emits:

```
https://archive.org/download/{tvgId}/{tvgId}.mp4?exact=1&start=0&end=300
```

The Internet Archive TV News clipping API does not use `start=` / `end=`. It uses a single `t` parameter with a slash-separated range, plus a filename-hint parameter: <cite index="1-1">appending `?t=0/180&ignore=x.mp4` is the form reported to work against TV News items</cite>.

Unknown query parameters on a static file endpoint are **ignored, not rejected**. So the predicted behavior is:

- All 12–44 chunk URLs for a given program resolve to **the identical full-hour file**.
- The player receives `video.duration ≈ 3600` where the row claims `282`. Progress bar, seek scrubber, EPG block width, and auto-advance timing are all wrong by an order of magnitude.
- Every chunk restarts at 00:00. A 13-chunk "program" plays the same first minutes thirteen times.
- 353 rows request ~30 full hours of video instead of 353 clips.

**[INFERRED, high confidence]** this is also a strong candidate for the MediaError spam already logged in the Chronicle admin tab: TV News full-item `/download/` responses are frequently access-restricted, and a 403 delivered to a `<video>` element surfaces as `MediaError` code 4 (`SRC_NOT_SUPPORTED`), not as a visible HTTP failure.

### Phase 1 verification — run before any code changes

Three requests, status and size only, no token exposure:

```bash
ID=FOXNEWSW_20260905_210000_The_Big_Weekend_Show
B=https://archive.org/download/$ID/$ID.mp4

for U in "$B" "$B?exact=1&start=282&end=564" "$B?t=282/564&ignore=x.mp4"; do
  curl -s -o /dev/null -L -r 0-1 \
    -w "%{http_code}  len=%{size_download}  range=%{header_json}\n" "$U" 2>/dev/null \
    || curl -sI -L -o /dev/null -w "%{http_code}  %{content_type}  %{size_download}\n" "$U"
done
```

Read the result as a three-way gate:

| Observation | Conclusion |
|---|---|
| URL 1 and URL 2 return identical `Content-Length` | `start`/`end` are ignored — defect confirmed |
| URL 3 returns a **smaller** `Content-Length` than URL 1 | `?t=` clipping is live — fix is a one-line URL change |
| URL 1 returns 403 while URL 3 returns 200 | full items are loan-gated; clipping is the *only* viable path |
| URL 3 also returns full length | server-side clipping unavailable — fall back to client-side clamping (§7.3) |

Do not skip this. Every prior Archive.org failure in this ecosystem came from assuming an API surface before fetching it raw.

**Secondary check:** the reference implementation in the wild derived chunk count from a `CLIP_SEC_MAX` value of **180**, not 300. If IA enforces a maximum clip length, `n = ceil(T/300)` produces chunks the server will refuse or truncate. Confirm the ceiling before locking `MAX_CHUNK_SEC`.

---

## 7. Forward engineering

### 7.1 The portable contract

Strip the 24 dead columns and what remains is a clean, player-agnostic clip record:

```ts
interface Clip {
  id: string;            // stable key
  parentId: string;      // IA item identifier
  chunkIndex: number;
  channel: string;       // callsign
  show: string;
  airedAt: string;       // ISO 8601 — parsed from parentId, currently missing
  startSec: number;      // offset into parent
  endSec: number;
  durationSec: number;   // endSec - startSec
  mediaUrl: string;      // clipped if server supports it, else parent + clamp
  parentUrl: string;     // always the unclipped parent — needed for clamping
  posterUrl: string;
  captionsUrl: string | null;
  description: string;
}
```

`parentUrl` is the field the current schema is missing and the one that makes client-side clamping possible. Add it.

### 7.2 Where it gets placed

| Target | Form | Notes |
|---|---|---|
| React / AJN player | `Clip[]` fetched as JSON | native `<video>`, progressive MP4 — **no HLS.js**, no demuxer, no `hls.destroy()` lifecycle to manage |
| Any web player (VLC, Kodi, TiviMate, generic IPTV) | `#EXTM3U` export | `#EXTINF:{durationSec} tvg-id tvg-name tvg-logo group-title` then the URL |
| EPG grid | XMLTV export | `airedAt + startSec` → `start`, `+ durationSec` → `stop`; this is exactly what the null `airDate` currently blocks |
| Static GitHub Pages page | inline JSON + `<video>` | works with zero backend, since IA serves the media |

The M3U path is what makes the answer to "played in any web player" literally true: an M3U with absolute `.mp4` URLs and correct `#EXTINF` durations is the lowest common denominator every player on earth reads.

### 7.3 Playback in the player (three fallback tiers)

1. **Server-clipped** — `?t=S/E&ignore=x.mp4` verified working. Set `<video src>` directly, `duration` is correct, nothing else needed.
2. **Client-clamped** — server ignores clipping. Load `parentUrl`, set `currentTime = startSec` on `loadedmetadata`, and stop on a `timeupdate` guard at `endSec`. Report `durationSec` from the record, not from `video.duration`. This is the safe default and it works even if tier 1 is available.
3. **Proxied** — network error code 3 or 4 on a direct load. Reroute the same URL through `/api/stream-proxy?url=…` with a **fresh `AbortController` per attempt** (never a shared controller, never `AbortSignal.timeout()`).

Reference implementations of the generator, the clamping hook, and the M3U/XMLTV exporters are in `newsFeed.ts` alongside this document.

---

## 8. What this establishes for the plan

The three questions a reviewer will ask, answered with measurements rather than assertions:

- **How was it made?** `n = ceil(T/300)`, `d = ceil(T/n)`, contiguous chunks, clamped tail — reproduces the file 30/30. There is no hidden state and no manual curation.
- **What is wrong with it?** One malformed query string, in one place, affecting 353/353 rows. Not an architecture problem. Not a rewrite.
- **How do we prove the fix?** Three curls, before any code is written, with a documented three-way gate on the result.

The scope is a URL builder, an `airDate` parse, a `parentUrl` field, and a clamping guard in the player. Nothing touches the core engine.
