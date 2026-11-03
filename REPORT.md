# Player page video + captions layout — verification report

## TASK

Make the Player page fit within one viewport: video and captions side-by-side at desktop widths, a pinned video with a separately scrollable lower area on narrow screens, and an optional caption overlay inside the existing fullscreen stage. Preserve other pages, the one-player architecture, existing caption labels and test IDs. This report is for AJN Precision Engineering only.

## DID

- Built in an isolated worktree on `fix/player-split-captions-layout`, based on `origin/main` at `0d935f394f52827d9a31c71d00ed942cc14ed7fa`.
- The prior local checkout was at `90011e25aa385b5dea06905482afe95d525e5b7c`. The six commits on `origin/main` not present there were:
  - `4c4c855` Cable TV News freshness (#158)
  - `4a6fc61` AI Studio export merge, retaining #158 (#159)
  - `f63b22b` Radio dock preset wall (#161)
  - `7037418` Radio dock head-unit view (#162)
  - `0016a2c` Buffer diagnostics and cross-fade navigation
  - `0d935f3` Restore tests and tools deleted by the AI Studio export (#169)
- `0016a2c` and `4a6fc61` touched the App/player files named in the task. Those current-main versions were read before implementation.
- Node `v22.23.4`, npm `10.9.9`; `npm ci` completed successfully.
- Three local commits, not pushed:
  1. `ddac707c0219f055b0115778b096355315042288` — desktop and mobile layout, shared caption sidebar, bounded caption history.
  2. `36d8616571582ce13eb4484621eadcc2a2b7e25a` — optional overlay slot and native-subtitle exclusion.
  3. `13e511b1122fb113cfcc6379bb32359894dbd8e8` — synthetic browser matrix, audio-flow preservation, and test command.
- Final worktree was clean. No push, merge, or deployment was performed.
- The bounded `useCaptionTrack` history change was made only after the owner approved it: up to 200 already-loaded TV News cues; radio continues using its adapter’s existing default history behavior.

## FACTS

### Files and behavior

Changed relative to the stated base:

| File | Change |
|---|---|
| `src/App.tsx` | Measures visible top and mobile-bottom navigation with `ResizeObserver`; sets `--ajn-nav-h`; constrains video-only Player routes and preserves audio Player document flow. |
| `src/index.css` | Player-only viewport layout; desktop 360 px sidebar; mobile pinned stage/lower scroll area; viewport-height fallback and 16:9 sizing. |
| `src/components/PlayerView.tsx` | Shared caption state; desktop columns and mobile ordering; optional overlay preference and control. |
| `src/news/captions/CaptionPanel.tsx` | Accepts shared caption state and sidebar variant while retaining legacy props. |
| `src/news/captions/CaptionStrip.tsx` | Sidebar history scroll, current cue, stop-follow-on-user-scroll, and Jump to live; inline rendering remains the default. |
| `src/news/captions/useCaptionTrack.ts` | Approved TV News history bound set to 200 already-loaded cues; no new request path. |
| `src/MinimalPlayer.tsx` | Only the permitted optional `overlaySlot?: ReactNode` prop, rendered inside the existing stage/container. |
| `src/components/SubtitleToggle.tsx` | Reports whether loaded native English subtitles are showing, so the overlay is disabled while native text is drawn. |
| `package.json` | Adds `test:captions`, combining the unchanged caption output/unit tests with the new browser matrix. |
| `test-player-captions-layout.html` | Synthetic fixture shell. |
| `test-player-captions-layout.tsx` | Synthetic fixture component with clearly labeled invented cues and no media bytes. |
| `test-player-captions-layout.mjs` | Chromium layout, caption-scroll, route-fixture, overlay, native subtitle, and fullscreen checks. |

No new `any` was added. The only `MinimalPlayer.tsx` change is the allowed optional slot. `package-lock.json`, server/proxy, playback engine, guide, and telemetry were not changed. `index.html` was not changed.

`App.tsx` also drops a stale unsupported `onPlayerPage` prop from `RadioDock`; `miniPlayerShowing` already uses `destination !== 'player'`, and the `MiniPlayerDock` render is already guarded by the same condition. This was needed for the current component typecheck. The browser fixture confirms the dock appears on the other four routes; the production App condition itself excludes it on Player.

### Navigation and sizing measurements

The test browser measured the top header as sticky: desktop `53 px`; mobile `57 px`. Mobile bottom tabs are fixed and `56 px`. `--ajn-nav-h` measures the visible combined area: `53 px` desktop and `113 px` mobile. The measured values—not a guessed constant—drive the player-only height.

Desktop uses a 360 px caption sidebar when caption phase is planning/none/paused/error/ready; phase `off` removes the sidebar and uses the full-width column. The stage’s actual video element is constrained to 16:9 by the available stage dimensions. Mobile keeps the video first and caps its height at 40dvh; the caption panel is first in the lower internally scrolling area. Video scenarios have no document scroll in the 63-combination matrix. The audio Player route preserves normal document flow; where its content exceeds the viewport, the matrix labels it `AUDIO FLOW` and verifies its main container is not overflow-hidden.

### Registry coverage and channel types

`server/sources/archiveNews.ts:278-292` lists 12 News network configurations:

- CC5/align fixture row: FOXNEWSW, CNNW, MSNOW/MSNOWW/MSNBCW, BBCNEWS. The caption source is selected from item metadata; the layout does not special-case the network.
- ASR fixture row: ALJAZ and DW when the item metadata selects ASR.
- No-caption fixture row: any News item with no listed subtitle file.
- Not-eligible and live fixture rows: non-News/no-Archive-path items; these made zero caption API requests.
- Other configured networks: RT, KPIX, CBCNEWS, CTV, FRANCE24, TRTWORLD. They were not separately represented by network-specific fixture data; their source type is still item-metadata-driven, so actual items would follow the CC/align, ASR, or none behavior above. Their real caption availability was not tested.

`channels.ts:26-31` has the four canonical older live-news channel entries: Fox News/FOXNEWSW, CNN/CNNW, MSNBC/MSNBCW, and BBC News/BBCNEWS. ABC is not in `NEWS_NETWORKS` on this base.

Rumble and YouTube embeds exist outside the Player route: `src/components/RumbleNewsWall.tsx:322-330` renders a Rumble iframe, and `src/news/providers/youtube.ts:61-69` creates YouTube embed URLs. They are not player-page media fixtures and were not opened or decoded here. The `live` row is a synthetic non-Archive-path player fixture, not a real live channel.

### Verification outputs

Commands and results, all against the isolated worktree:

```text
Node: v22.23.4
npm: 10.9.9
npm ci: exit 0
NET_GUARD=block NODE_OPTIONS=--max-old-space-size=1500 npx tsc --noEmit: exit 0
NET_GUARD=block npm run build: exit 0 (Vite emitted its existing >500 kB chunk advisory)
NET_GUARD=block npm run test:captions: exit 0
  test-caption-strip-output: passed
  test-captions.ts: 20 checks passed
  synthetic viewport/scenario matrix: 63/63
NET_GUARD=block npm run test:radio-ui: exit 0
  audio ASR service, radio caption logic, caption output, 9 station accents,
  9 station groups, station banner render: passed
PUPPETEER_EXECUTABLE_PATH=/repl/tools/bin/chromium NET_GUARD=block node test-audio-light-guide.mjs: exit 0
  phone and desktop; audio fixture passed; Archive requests 0; external requests 0
```

The browser reports 0 JavaScript errors and 0 Archive requests. The network guard blocked one existing external `fonts.googleapis.com/css2` attempt. The screenshots are synthetic: the fixture has no video bytes, so its player status can say “Reconnecting”; that is not a real playback failure or proof of playback.

### Browser matrix

Every video row passed document `scrollHeight <= innerHeight`, video-bottom-in-viewport, and 16:9 checks. Audio rows have no video; audio content that naturally exceeds the viewport is marked `AUDIO FLOW`, not a video-layout failure. Sidebar is present for CC5, align, ASR, and none; absent for ineligible, live, nonarchive, movie, and radio.

| Scenario | Viewport | Document scroll | Video rect (x,y,w,h) | Bottom in viewport | 16:9 | Caption panel rect | Sidebar | Phase | Caption API requests |
|---|---:|---|---|---|---|---|---|---|---:|
| cc5 | 1440x900 | PASS | 32,195,1000,563 | PASS | PASS | 1048,65,360,823 | Y | ready | 2 |
| cc5 | 1366x768 | PASS | 32,150,926,521 | PASS | PASS | 974,65,360,691 | Y | ready | 2 |
| cc5 | 1280x720 | PASS | 32,150,840,473 | PASS | PASS | 888,65,360,643 | Y | ready | 2 |
| cc5 | 1024x768 | PASS | 32,246,584,329 | PASS | PASS | 632,65,360,691 | Y | ready | 2 |
| cc5 | 768x1024 | PASS | 24,65,720,405 | PASS | PASS | 37,512,694,329 | Y | ready | 2 |
| cc5 | 390x844 | PASS | 12,65,366,206 | PASS | PASS | 25,330,340,223 | Y | ready | 2 |
| cc5 | 844x390 | PASS | 283,65,277,156 | PASS | PASS | 37,263,770,101 | Y | ready | 2 |
| align | 1440x900 | PASS | 32,195,1000,563 | PASS | PASS | 1048,65,360,823 | Y | ready | 2 |
| align | 1366x768 | PASS | 32,150,926,521 | PASS | PASS | 974,65,360,691 | Y | ready | 2 |
| align | 1280x720 | PASS | 32,150,840,473 | PASS | PASS | 888,65,360,643 | Y | ready | 2 |
| align | 1024x768 | PASS | 32,246,584,329 | PASS | PASS | 632,65,360,691 | Y | ready | 2 |
| align | 768x1024 | PASS | 24,65,720,405 | PASS | PASS | 37,512,694,329 | Y | ready | 2 |
| align | 390x844 | PASS | 12,65,366,206 | PASS | PASS | 25,330,340,275 | Y | ready | 2 |
| align | 844x390 | PASS | 283,65,277,156 | PASS | PASS | 37,263,770,153 | Y | ready | 2 |
| asr | 1440x900 | PASS | 32,195,1000,563 | PASS | PASS | 1048,65,360,823 | Y | ready | 2 |
| asr | 1366x768 | PASS | 32,150,926,521 | PASS | PASS | 974,65,360,691 | Y | ready | 2 |
| asr | 1280x720 | PASS | 32,150,840,473 | PASS | PASS | 888,65,360,643 | Y | ready | 2 |
| asr | 1024x768 | PASS | 32,246,584,329 | PASS | PASS | 632,65,360,691 | Y | ready | 2 |
| asr | 768x1024 | PASS | 24,65,720,405 | PASS | PASS | 37,512,694,329 | Y | ready | 2 |
| asr | 390x844 | PASS | 12,65,366,206 | PASS | PASS | 25,347,340,206 | Y | ready | 2 |
| asr | 844x390 | PASS | 283,65,277,156 | PASS | PASS | 37,263,770,101 | Y | ready | 2 |
| none | 1440x900 | PASS | 32,195,1000,563 | PASS | PASS | 1048,65,360,823 | Y | none | 1 |
| none | 1366x768 | PASS | 32,150,926,521 | PASS | PASS | 974,65,360,691 | Y | none | 1 |
| none | 1280x720 | PASS | 32,150,840,473 | PASS | PASS | 888,65,360,643 | Y | none | 1 |
| none | 1024x768 | PASS | 32,246,584,329 | PASS | PASS | 632,65,360,691 | Y | none | 1 |
| none | 768x1024 | PASS | 24,65,720,405 | PASS | PASS | 24,482,720,381 | Y | none | 1 |
| none | 390x844 | PASS | 12,65,366,206 | PASS | PASS | 12,283,366,345 | Y | none | 1 |
| none | 844x390 | PASS | 283,65,277,156 | PASS | PASS | 24,233,796,25 | Y | none | 1 |
| ineligible | 1440x900 | PASS | 97,121,1246,701 | PASS | PASS | none | N | off | 0 |
| ineligible | 1366x768 | PASS | 177,121,1012,569 | PASS | PASS | none | N | off | 0 |
| ineligible | 1280x720 | PASS | 177,121,926,521 | PASS | PASS | none | N | off | 0 |
| ineligible | 1024x768 | PASS | 32,136,960,540 | PASS | PASS | none | N | off | 0 |
| ineligible | 768x1024 | PASS | 24,65,720,405 | PASS | PASS | none | N | off | 0 |
| ineligible | 390x844 | PASS | 12,65,366,206 | PASS | PASS | none | N | off | 0 |
| ineligible | 844x390 | PASS | 283,65,277,156 | PASS | PASS | none | N | off | 0 |
| live | 1440x900 | PASS | 97,121,1246,701 | PASS | PASS | none | N | off | 0 |
| live | 1366x768 | PASS | 177,121,1012,569 | PASS | PASS | none | N | off | 0 |
| live | 1280x720 | PASS | 177,121,926,521 | PASS | PASS | none | N | off | 0 |
| live | 1024x768 | PASS | 32,136,960,540 | PASS | PASS | none | N | off | 0 |
| live | 768x1024 | PASS | 24,65,720,405 | PASS | PASS | none | N | off | 0 |
| live | 390x844 | PASS | 12,65,366,206 | PASS | PASS | none | N | off | 0 |
| live | 844x390 | PASS | 283,65,277,156 | PASS | PASS | none | N | off | 0 |
| nonarchive | 1440x900 | PASS | 97,121,1246,701 | PASS | PASS | none | N | off | 0 |
| nonarchive | 1366x768 | PASS | 177,121,1012,569 | PASS | PASS | none | N | off | 0 |
| nonarchive | 1280x720 | PASS | 177,121,926,521 | PASS | PASS | none | N | off | 0 |
| nonarchive | 1024x768 | PASS | 32,136,960,540 | PASS | PASS | none | N | off | 0 |
| nonarchive | 768x1024 | PASS | 24,65,720,405 | PASS | PASS | none | N | off | 0 |
| nonarchive | 390x844 | PASS | 12,65,366,206 | PASS | PASS | none | N | off | 0 |
| nonarchive | 844x390 | PASS | 283,65,277,156 | PASS | PASS | none | N | off | 0 |
| movie | 1440x900 | PASS | 97,121,1246,701 | PASS | PASS | none | N | off | 0 |
| movie | 1366x768 | PASS | 177,121,1012,569 | PASS | PASS | none | N | off | 0 |
| movie | 1280x720 | PASS | 177,121,926,521 | PASS | PASS | none | N | off | 0 |
| movie | 1024x768 | PASS | 32,136,960,540 | PASS | PASS | none | N | off | 0 |
| movie | 768x1024 | PASS | 24,65,720,405 | PASS | PASS | none | N | off | 0 |
| movie | 390x844 | PASS | 12,65,366,206 | PASS | PASS | none | N | off | 0 |
| movie | 844x390 | PASS | 283,65,277,156 | PASS | PASS | none | N | off | 0 |
| radio | 1440x900 | AUDIO FLOW | audio-only | PASS | n/a | none | N | audio | 0 |
| radio | 1366x768 | AUDIO FLOW | audio-only | PASS | n/a | none | N | audio | 0 |
| radio | 1280x720 | AUDIO FLOW | audio-only | PASS | n/a | none | N | audio | 0 |
| radio | 1024x768 | AUDIO FLOW | audio-only | PASS | n/a | none | N | audio | 0 |
| radio | 768x1024 | PASS | audio-only | PASS | n/a | none | N | audio | 0 |
| radio | 390x844 | PASS | audio-only | PASS | n/a | none | N | audio | 0 |
| radio | 844x390 | AUDIO FLOW | audio-only | PASS | n/a | none | N | audio | 0 |

Additional browser checks:

- 200 synthetic cues: initially at bottom; follows new cues; user scroll-up stops following; Jump to live restores it.
- Home, TV Guide, Library, Radio route fixtures: persistent player hidden, fake playhead advances, mini dock visible, and page scrolling remains normal. The Player fixture also asserts the mini dock is absent there. These are fixture-route assertions rather than an end-to-end run of the live app.
- Fullscreen API: existing stage contains the video and overlay; the sidebar is outside fullscreen.
- Native subtitles: overlay toggle disables and overlay is absent while English native subtitles are showing.
- Reduced-motion check: the new sidebar follows by setting `scrollTop` directly (no smooth-scroll animation); existing global reduced-motion CSS remains in force.

### Screenshots

Included in the ZIP and separately attached:

- `screenshots/player-1440x900.png`
- `screenshots/player-1280x720.png`
- `screenshots/player-390x844.png`

They are synthetic browser fixtures, not production playback screenshots.

## ERRORS

- An additional existing `npm run test:guide-ui` attempt passed four aired-time checks but timed out in the unchanged Classic light-guide test waiting for `[data-channel-row-loading="demo-channel-060"]`. `src/EpgGuide.tsx` and that test were not changed. This is separate from the Player-page gates.
- Build passed with Vite’s existing advisory about bundles over 500 kB. No build error.
- The synthetic player has no loaded media bytes and can display its fixture “Reconnecting” message. This does not establish a live-player or network failure.

## NOT DONE AND WHY

- Real ABC live playback, real per-program caption timing/availability, and real playback on each registered channel were not verified; all browser media/cue content was synthetic.
- iOS Safari address-bar behavior, Android Chrome on a device, Cloud Run, and actual Rumble/YouTube iframe playback were not tested here.
- The browser route regression used a synthetic fixture. The actual `App.tsx` source still hides `MiniPlayerDock` whenever the destination is `player`, but the four page routes were not driven end-to-end through the full live App.
- No real channel-switch memory/heap snapshot was taken.

## NEED FROM OWNER

After applying the drop-in to the stated base, check Player on ABC live at 1366x768 and on a phone at 390x844: confirm the document does not scroll, the video and captions are visible, and the caption panel can be independently scrolled. The test screenshots are synthetic only.

## Rollback

On the local branch, revert the three commits in reverse order:

```bash
git revert 13e511b1122fb113cfcc6379bb32359894dbd8e8
git revert 36d8616571582ce13eb4484621eadcc2a2b7e25a
git revert ddac707c0219f055b0115778b096355315042288
```
