---
name: ajn-prelude
description: Read first in any AJN Precision Engineering session. Sets scope, doctrine and which AJN skill to load for search, EPG, channels, telemetry, testing, walkthroughs or help.
---

# AJN prelude (session start)

## Scope
- Target: `banamine/AJN-Precision-Engineering` (`main`) only. Not `AJN-pro-play-`, not `AJN-Media-Console`.
- Live app: ajn-precision-engineering.ai.studio (AI Studio → Cloud Run). Replit is a test/review environment.
- Canonical slice every feature must consume: `M3U → MediaAsset → EPG/channel → direct-MP4 PlaybackPlan → playback`.

## Doctrine (non-negotiable)
1. Evidence first: logs, curl output, screenshots, network panel. "It builds" is not evidence.
2. Investigate → implement → verify. No fix proposal before evidence.
3. No fake telemetry (`Math.random()`, hardcoded metrics) and no silent fallbacks (BigBuckBunny, synthetic channels). Failures show a truthful error state.
4. One implementation: extend the existing proxy/guide/store; never add a parallel one.
5. Protected core, change only with cause: UnifiedPlaybackEngine, BroadcastTVGuide, PlayerStore, StatusIndicatorBar, ChannelManager, SchedulerEngine, PluginHost, ArchiveProvider, IPTVProvider, DiagnosticsHUD.
6. Proxy responses are bounded 206 slices (≤ 8 MiB); Cloud Run rejects > 32 MiB.
7. Before editing, locate real files with `grep -rn` / `git ls-files`; never guess paths. Root-level duplicate/dropin trees exist — confirm which `server.ts` is imported by the build.

## Skill router
| Task | Load |
|---|---|
| Tour the app / first look | `ajn-app-walkthrough` |
| Archive / catalog search | `ajn-expert-search` |
| Guide layout, schedules, air times | `ajn-epg-organization` |
| Add a channel or source | `ajn-add-channel` |
| M3U import problems | `ajn-m3u-ingest` |
| Health, alerts, diagnostics | `ajn-telemetry-reading` |
| Video won't play | `ajn-playback-triage` |
| Archive-wide failures | `ajn-archive-outage` |
| Review a change / PR | `ajn-change-review` |
| UI screenshot pass | `ajn-visual-review` |
| Explain features / help text | `ajn-help-support` |
| Write the final report | `ajn-report-format` |
