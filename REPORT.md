# PARTIAL — AJN Classic Network / InfoBattalion

## TASK
Reconstruct the Classic Network build and selected owner-list refresh from base
`d33c54ac059f752b1a394adc4b877d337e92a426`, preserve all existing manifest rows,
run offline validation, and prepare one cumulative review ZIP. No push, merge,
deployment, PR, or publication was performed.

## DID
- Branch: `feat/classic-network-2026-11-04`.
- Local commits:
  - `a6632b0fd0ccc3c7bb653cff792132dcdbe899d2` — scheduler/catalog source and tests.
  - `5e003dbec9e55be301a97558952c3de37808d323` — additive list refresh and tests.
  - `0470512f11ec148566a42cea3d5a090baa50289b` — generated publications and manifest.
- Current HEAD: `0470512f11ec148566a42cea3d5a090baa50289b`.
- The cumulative repository delta is 29 feature files. `.replit` and
  `.replitignore` are workspace-only settings and are excluded from the ZIP.
- Classic Network schedule: 611 catalog assets / distinct episode keys; 3,186
  scheduled occurrences; configured start is 2026-11-05 00:00
  America/Los_Angeles. Revision:
  `a14eafdb642e39d597ed6df79841edae0199cda07f3958f1a38d104178eb1645`.
  Across the compiled horizon the shortest repeated-episode start gap is
  168.943 hours; zero gaps are below 168 hours.
- Classic Movies schedule: 844 program occurrences; revision
  `c02db66b209a83020fdc936745288a058dd4d7b38925983df3ef9d08d6dffc02`.
- The earlier owner-authorized refresh used 218 physical Archive starts and
  recorded 218 HTTP 200 results, zero redirects, and a minimum gap of
  1,550.1 ms. This is 218 of the 1,800-start cap. No Archive calls were made
  during the offline rerun, tests, build, or localhost checks.
- Actual Extra Channels manifest delta: 1,366 rows added, zero removed, zero
  changed shared rows: Movies 19, Cartoons 465, Classic TV 882, Documentaries 0.
  A second offline rerun left the Extra Channels manifest byte-identical
  (SHA-256 `34d0e072610ccd6ab888ff29550ef6f8fd92b1f053e9c7ef960ad7fd7296555e`).
- The builder’s Documentary selection counters still report 29 candidate IDs /
  645 candidate rows on rerun, but the Documentary manifest has no net diff.
  Treat those counters as candidates, not as additions. This reporting
  discrepancy is called out rather than presented as published data.
- Local API checks: `/api/health` 200 (465 bytes), `/api/archive/status` 200
  (253 bytes), full Classic TV schedule 200 (35,408,571 decoded bytes /
  3,186,894 gzip bytes; 375 channels / 29,635 programs), and light schedule
  200 (1,008,686 bytes; 375 channels / 741 programs, below 2 MiB).
- The generated catalog title audit shows Danger Man’s first cleaned episode
  title as “View from the Villa,” not “Destination Danger.” The other sampled
  first titles were Benson, The Dick Van Dyke Show, Get Smart, Hogan’s Heroes,
  and Taxi episode titles.

## FACTS
- Death Valley Days: no exact show rows were found in the checked-in manifests
  or retained metadata cache. `tvx-riders-of-death-valley-1941` is a different
  channel and is not evidence for Death Valley Days.
- The Odd Couple: 269 distinct identifier/file rows across the searched
  manifest sources; 114 distinct S/E codes; one app-manifest row has a stored
  duration. The retained parent-item metadata has 12 matching filenames, only
  two with a length value. This is insufficient for admission or a claim that
  all episodes play.
- No show is marked playback-verified. The included screenshot is only the
  current TV Guide viewport; it is not evidence of new-item playback.
- Rights and third-party-content approval remain the owner’s decision.

## ERRORS
- The Documentary candidate counters are not net manifest deltas.
- Python’s 34-test suite passes but emits non-fatal `ResourceWarning` messages
  for existing unclosed file reads.
- The production build completed with existing unresolved-runtime-asset and
  large-chunk warnings.

## NOT DONE AND WHY
- No live media playback or first-slice checks were performed for the six
  scheduled shows; no Archive request was made after the bounded list refresh.
- Death Valley Days and The Odd Couple were not admitted because evidence is
  insufficient.
- No rights decision, remote CI run, PR, push, merge, or deployment.
- No full cross-device visual-regression set. One baseline viewport screenshot
  is included and explicitly is not playback proof.

## NEED FROM OWNER
1. Provide a source identifier for Death Valley Days if it should be
   investigated; it is absent from retained evidence.
2. Decide whether to pursue the Documentary candidates; the source candidate
   counters do not prove net additions.
3. Approve a separate live playback verification run before any playability
   claim, and review rights/ownership.
4. Provide a third show for a future verification sample if required.

## STOP / GO
Recommendation: **HOLD publication as playback-verified.** The offline
schedule, recurrence invariant, payload ceiling, build, and tests passed, but
media playback and rights remain unverified. This package is PARTIAL and for
owner review only.
