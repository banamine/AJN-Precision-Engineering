AJN PLAYER PAGE CAPTIONS LAYOUT — LOCAL DROP-IN

Base required:
  origin/main 0d935f394f52827d9a31c71d00ed942cc14ed7fa

This package contains the three locally verified commits from branch
fix/player-split-captions-layout. It has NOT been pushed, merged, or deployed.
Apply only to the stated base; review REPORT.md and the synthetic screenshots.

Changed repository files:
  package.json
  src/App.tsx
  src/MinimalPlayer.tsx
  src/components/PlayerView.tsx
  src/components/SubtitleToggle.tsx
  src/index.css
  src/news/captions/CaptionPanel.tsx
  src/news/captions/CaptionStrip.tsx
  src/news/captions/useCaptionTrack.ts
  test-player-captions-layout.html
  test-player-captions-layout.mjs
  test-player-captions-layout.tsx

The useCaptionTrack history bound is up to 200 already-loaded TV News cues,
following the owner's approval. It introduces no new request or second player.
MinimalPlayer only receives the optional overlaySlot prop.
Only video on the Player route is height-constrained; audio playback retains
the existing document-flow layout.

Apply by copying these repository-relative files over the matching files in a
clean checkout of the required base. Then run:
  npm ci
  NODE_OPTIONS=--max-old-space-size=1500 npx tsc --noEmit
  npm run build
  NET_GUARD=block npm run test:captions
  NET_GUARD=block npm run test:radio-ui

Evidence: typecheck/build passed; caption checks passed (20 unit checks and
63 synthetic viewport/scenario combinations); radio UI checks passed. The
browser fixture uses invented caption cues and no media bytes. No Archive
requests were made. This is not proof of real playback or device behavior.

Screenshots are in screenshots/ and show synthetic fixtures, not production
media playback. The full measurements and limitations are in REPORT.md.
Command outputs are summarized in VERIFICATION_OUTPUT.txt.

Local commits:
  ddac707c0219f055b0115778b096355315042288  layout and caption sidebar
  36d8616571582ce13eb4484621eadcc2a2b7e25a  optional caption overlay
  13e511b1122fb113cfcc6379bb32359894dbd8e8  browser tests and audio-flow regression

Rollback: revert those three commits in reverse order; commands are at the end
of REPORT.md. No workflow, server, proxy, playback engine, guide, telemetry,
or package lockfile was changed.
