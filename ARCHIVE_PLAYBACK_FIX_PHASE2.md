# Archive Playback Fix — Phase 2

Source baseline: `ajn-precision-engineering (17).zip`

## Evidence basis

Phase 1 browser A/B testing showed:

- Archive.org MP4 loads in native `<video>` without `crossOrigin`.
- AJN Archive proxy loads in native `<video>` without `crossOrigin`.
- The same sources fail with `crossOrigin="anonymous"` and MediaError code 4.
- BigBuckBunny reproduced the same crossOrigin-dependent failure.
- Proxy seeking/range behavior worked.

## Applied change

Removed `crossOrigin="anonymous"` from the canonical native `<video>` element in:

- `src/MinimalPlayer.tsx`
- `AJN-FINAL-DROPIN/src/MinimalPlayer.tsx`

No server proxy, Archive URL construction, News routing, telemetry, or HLS lifecycle changes were made.

## Required Claude audit

Audit the ZIP before deployment. Confirm the above is the only runtime playback change and run the project's typecheck/build plus Classic TV, AJN Daily, and News playback verification.

Do not make additional fixes unless new evidence identifies a separate failure.
