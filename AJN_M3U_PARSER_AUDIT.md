# AJN M3U Parser Audit

**Audit branch:** `audit/m3u-parsers`  
**Base:** `fix/p1` at `296b916927b4b7b08afdb610734caf6871bc60d2`  
**Scope:** read-only architectural audit plus an isolated offline differential harness.  
**Production behavior:** unchanged.

## 1. Corrected architecture

[read from code: `guideRegistry.ts@296b9169`] The repository contains two M3U parsers with three live consumers:

```text
M3U input
├── guideRegistry.parseM3u()
│   └── ingestM3uPlaylist()
│       └── Channel + ChannelSource
│
└── parseM3uEntries()
    ├── server/sources/liveTv.ts
    │   └── Program records
    ├── server/sources/dailyHighlights.ts
    │   └── Program records
    └── scripts/live-tv-probe.ts
```

[read from code: `server/sources/classicM3u.ts@296b9169`] `parseM3uEntries` is production parser code.

[read from code: `test-source-contracts.ts@296b9169`] `classicM3uContract` is a production `SourceContract` wrapper exported from the same module and exercised by the source-contract regression. It is not the second parser.

[read from code: `guideRegistry.ts@296b9169`] `guideRegistry.parseM3u` feeds `ingestM3uPlaylist`, which is used for `INITIAL_PLAYLISTS` and playlist synchronization. That path creates/updates `Channel` and `ChannelSource` records and does not register a `Program` for each parsed entry.

**Known Gaps item 4:** the two parsers are `guideRegistry.parseM3u` and `parseM3uEntries`.

## 2. Consumer inventory

### `guideRegistry.parseM3u`

[read from code: `guideRegistry.ts@296b9169:136-199,253`] The parser is exported and consumed by `ingestM3uPlaylist`. Startup ingestion iterates `INITIAL_PLAYLISTS`; `syncPlaylist` invokes the same ingestion path for a supplied playlist.

[read from code: `guideRegistry.ts@296b9169:150-198`] Each retained entry becomes a canonical Channel identity and a ChannelSource identity. The function updates playlist sync state and returns an ingestion count. No Program is created in this loop.

### `parseM3uEntries` — Live TV

[read from code: `server/sources/liveTv.ts@296b9169:1-10,50-115`] Live TV imports `parseM3uEntries`, downloads configured M3U lists, rejects unusable entries, de-duplicates URLs, derives a channel ID, then creates a `Program` containing program, asset, source, and media identities.

[read from code: `guideRegistry.ts@296b9169:275-282`] `guideRegistry` invokes `liveTvContract` through `runSources` and maps returned Programs into guide channels.

### `parseM3uEntries` — Daily Highlights

[read from code: `server/sources/dailyHighlights.ts@296b9169:75-120`] Daily Highlights downloads M3U playlists from the Archive, parses them with `parseM3uEntries`, derives a channel from the playlist/show, and creates Programs with asset/source identities.

[read from code: `guideRegistry.ts@296b9169:373-380`] `guideRegistry` invokes `dailyHighlightsContract` through `runSources`.

### `parseM3uEntries` — Live TV probe

[read from code: `scripts/live-tv-probe.ts@296b9169`] The transport probe imports `parseM3uEntries` directly to turn configured M3U source text into candidate channels before transport checks.

## 3. Parser input/output shapes

[read from code: `guideRegistry.ts@296b9169:136-149`] `parseM3u` returns `ParsedM3uEntry[]` with title, URL, optional tvg identifiers/logo/group, and optional duration.

[read from code: `server/sources/classicM3u.ts@296b9169:10-27`] `parseM3uEntries` returns `ParsedEntry[]` with title, URL, numeric duration, and optional group/tvg metadata.

[read from code: `guideRegistry.ts@296b9169:136-149`] Parser A splits CRLF/LF, recognizes `#EXTINF`, extracts quoted attributes, parses an integer duration, and only emits an entry when a title is present when the URL line arrives.

[read from code: `server/sources/classicM3u.ts@296b9169:25-43`] Parser B splits CRLF/LF, recognizes `#EXTINF`, extracts double-quoted attributes, parses integer or decimal duration, and emits an entry when a non-comment URL line follows an EXTINF record.

## 4. Code-read hypotheses

The following are hypotheses to be verified by the offline harness.

| ID | Hypothesis | Current evidence |
|---|---|---|
| H1 | Attribute quote handling differs: Parser A accepts single/double quotes and requires a non-empty value; Parser B accepts double quotes and permits empty values. | [read from code: `guideRegistry.ts@296b9169:136-149`; `server/sources/classicM3u.ts@296b9169:25-43`] |
| H2 | Parser A reads integer durations; Parser B also reads decimals. | [read from code: same parser ranges] |
| H3 | Parser A drops entries with empty titles; Parser B can retain an empty title. | [read from code: same parser ranges] |
| H4 | Live TV duplicate channel IDs receive `-2`, `-3`, etc. according to encounter order. | [read from code: `server/sources/liveTv.ts@296b9169:65-75`] |

H4 is an identity-stability candidate, not yet a confirmed defect.

## 5. Offline corpus

[not verified until Claude executes the harness] The isolated harness uses no network requests and includes:

- repository-derived baseline entries matching current `INITIAL_PLAYLISTS` examples;
- single-quoted attributes;
- empty attributes;
- decimal durations;
- CRLF;
- UTF-8 BOM;
- `#EXTVLCOPT` between EXTINF and URL;
- missing title;
- missing URL;
- duplicate `tvg-id`;
- spaces in URLs;
- normal, missing, and malformed `#EXTM3U` headers.

The corpus is intentionally small and diagnostic. It is not presented as a complete M3U conformance suite.

## 6. Differential harness

[read from code: `scripts/audit-m3u-parsers.ts`] The harness imports the two parser functions directly, executes every fixture through both parsers, and prints a Markdown comparison table.

It reports:

- fixture name;
- Parser A entry count and normalized entries;
- Parser B entry count and normalized entries;
- whether the serialized outputs are equal.

The harness does not mutate registries, make network calls, update package scripts, or participate in CI.

[not verified] Runtime observations require Claude's local execution of the harness.

## 7. Identity audit

[read from code: `src/utils/epgIdentity.ts@296b9169`] The repository has these five identity functions:

- `normalizeChannelIdentity`
- `normalizeProgramIdentity`
- `normalizeSourceIdentity`
- `normalizeAssetIdentity`
- `sanitizeIdentityUrl`

[read from code: `guideRegistry.ts@296b9169:150-180`] The playlist-registry path uses `normalizeChannelIdentity` with `tvgId` when present, otherwise `tvgName || title`, plus guide ID; it sanitizes the media URL before constructing source identity and uses the resulting channel ID, URL, and protocol for `normalizeSourceIdentity`.

[read from code: `server/sources/liveTv.ts@296b9169:65-85`] Live TV derives `channelId` from `tvgId || name`, adds order-dependent duplicate suffixes, then passes `${channelId}|live` as Program external ID. Asset identity uses the entry URL as external ID; Source identity uses the channel ID and source-list URL.

[read from code: `server/sources/dailyHighlights.ts@296b9169:100-120`] Daily Highlights derives Program external IDs from show + episode when episode metadata exists, otherwise show + entry URL. Asset identity uses that external ID; Source identity uses the channel and Archive playlist path.

[read from code: `server/sources/classicM3u.ts@296b9169:48-86`] The Classic M3U contract derives Program external IDs from show + episode or show + title, then uses the existing identity functions for Program, Asset, and Source identities.

[read from code: `src/utils/epgIdentity.ts@296b9169:1-80`] `sanitizeIdentityUrl` strips configured ephemeral query parameters before identity hashing. No identity function is changed by Task A.

## 8. Registry / Program question

[read from code: `guideRegistry.ts@296b9169:150-199`] The playlist-registry path currently uses Channel and ChannelSource as its state model.

[not verified] This audit does not assume that Program registration is required. The question is whether the consumers of playlist-registry state require Program-level schedule/media semantics. That requires tracing those consumers before Task B.

## 9. Classified divergence table

[not verified: pending Claude local run] This section is intentionally left as a classification result rather than a code-read conclusion.

The harness output will be classified into:

1. **Equivalent** — implementation differs but meaningful result is the same.
2. **Intentional normalization difference** — different result is deliberate and contractually acceptable.
3. **Genuine regression** — valid input or established behavior is lost.
4. **Unresolved** — evidence is insufficient.

No difference will be labeled a regression solely because the outputs are textually different.

## 10. Task B options

[not verified: pending Section 9 evidence] Task B will compare, at minimum:

### Option A — Keep two parsers

Retain separate consumers but establish shared behavioral contract tests and explicitly document intentional differences.

### Option B — Unify the parsers

Select one canonical parsing implementation, migrate consumers, preserve any required compatibility semantics with explicit tests, and retire the duplicate only after evidence supports removal.

Trade-offs will be recorded after the classified divergence table exists. Task A makes no recommendation between these options.

## Audit boundary

[read from code / process constraint] Task A does not modify parser behavior, identity functions, Program registration, PlaybackPlan behavior, production playback, workflows, manifests, or package scripts.

[not verified] The harness must be executed by Claude locally. Its output is required before Task B is designed.
