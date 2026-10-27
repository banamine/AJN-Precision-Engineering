# J2 — Live NTD news supplement — final C5 report

**Verdict: C5 PASS (zero regressions).** The verifier command exits 1 because five entries remain inherited J1 failures; all five have `baselineStatus=FAIL`. No timeout occurred. The one earlier hash regression was resolved by updating only the `verifykit:self-test` ledger entry to the new deterministic 33-case output.

## Stacked base hashes

| Layer | SHA-256 |
|---|---|
| Owner export | `002749be159fb37413495bdfd0273475b8dfdaf21ca9a4a9ee2d154577249353` |
| Google Builder overlay | `240a3ce932838dc5e44244884d530a8fc7634b7c7116e6176a2da14a9f4b1e3b` |
| J1 verify-kit ZIP | `1556b38e1011e9c230f7ba67cefa7c88fe2bf516083d7c9a73f97efba85c5194` |
| Prior J2 review ZIP | `475265a83220532ebd9223c295fc97b42d911af3489d7ff2b78c2f38bf527594` |

## C5 run

- Node: `v22.22.0`.
- Exact command: `NET_GUARD=block node tools/ajn-verify/run.mjs --changed --files server/sources/liveTv.ts,tools/ajn-verify/run.mjs,tools/ajn-verify/self-test.mjs`
- Result: `selected=57 pass=52 needs-stub=0 needs-harness=0 blocked-dependency=0 fail=5 timeout=0 regressions=0`.
- The five failures below match J1. No regression remains. `verifykit:self-test` passes and its current hash matches.
- Verifier self-test: `VERIFYKIT_SELF_TEST_PASS cases=33`.
- Preflight load: `0.22`, no stale Node/tsx/Vite processes. Post-run process inventory: no Node/tsx/Vite matches.
- Network: `NET_GUARD=block`; 238 total outbound attempts were intercepted by the guard, including Archive attempts; physical Archive requests: **0**.

### Ledger re-seed (one entry only)

- Entry: `verifykit:self-test`. Old hash: `306be03e026372eee21f138e96495c0053ef804130274d61b6e56998039aa323`. New hash: `0a7f386b98630c3c653557b29565cbd7d760169a5ca49cbef3a07390a0172709`.
- Reason: its sole stdout line changed from `VERIFYKIT_SELF_TEST_PASS cases=32` to `VERIFYKIT_SELF_TEST_PASS cases=33` when the descendant-process cleanup self-test was added.
- Verified against the pre-reseed ledger: this was the only `lastKnownGoodStdoutSha256` value changed.

### C5 failures and baseline comparison

| Entry | Current C5 | J1 ledger | Previously run alone |
|---|---:|---:|---:|
| `file:test-cable-news-guide.ts` | FAIL, 2.9s | FAIL | FAIL, 3.3s |
| `file:test-movies-classics.js` | FAIL, 2.2s | FAIL | FAIL, 11.0s |
| `file:test-organizer-output.ts` | FAIL, 3.2s | FAIL | FAIL, 3.8s |
| `script:test:movies-classics` | FAIL, 2.6s | FAIL | FAIL, 3.4s |
| `script:test:cable-news-guide` | FAIL, 3.4s | FAIL | FAIL, 3.0s |

These are inherited J1 failures, not new regressions. The full C5 report below records all 57 selected entries and timings.

## J2 implementation evidence

- Synthetic live-TV source: 1,504 upstream fixture channels plus eight pinned additions = 1,512; 11 NTD rows, 11 distinct URLs and IDs, all in `News`.
- Duplicate URL precedence: upstream owns the matching URL and retains its metadata.
- API fixture smoke: `/api/schedule?guide=live-tv` returned the expected 1,512-channel payload. The last C5 run measured live-TV file/script checks as PASS at 10.2s and 9.8s respectively.
- Earlier focused J2 typecheck, tests, production build and offline Cloud Run smoke passed on the reconstructed J2 base; details remain in the J2 implementation history. This recovery run specifically revalidated C5.

## Full C5 table

# AJN verify run report

Mode: changed; seeded: no; selected: 57.

Counts: PASS 52, NEEDS-STUB 0, BLOCKED-DEPENDENCY 0, FAIL 5, TIMEOUT 0, non-deterministic 37.

| Test | Status | Seconds | Guard attempts | Blocked hosts | Timing lines normalized | Hash match |
|---|---:|---:|---:|---|---:|---|
| file:test-ajn-rss-canonical.js | PASS | 2.2 | 0 | none | 0 | n/a |
| file:test-amc-phase2.ts | PASS | 2.4 | 0 | none | 0 | n/a |
| file:test-archive-item-guide.tsx | PASS | 4.7 | 0 | none | 0 | n/a |
| file:test-cable-news-guide.ts | FAIL | 2.9 | 0 | none | 0 | n/a |
| file:test-canonical-playback-slice.ts | PASS | 2 | 0 | none | 0 | yes |
| file:test-channel-focus.tsx | PASS | 3.8 | 14 | archive.org | 0 | n/a |
| file:test-classic-series-live.ts | PASS | 3.4 | 14 | archive.org | 0 | n/a |
| file:test-classic-upcoming.ts | PASS | 3.3 | 14 | archive.org | 0 | n/a |
| file:test-daily-rotation.ts | PASS | 2 | 0 | none | 0 | n/a |
| file:test-discovery-channel.ts | PASS | 1.3 | 0 | none | 0 | yes |
| file:test-epg-identity-producers.js | PASS | 1.2 | 0 | none | 0 | n/a |
| file:test-epg-program-lifecycle.js | PASS | 1.3 | 0 | none | 0 | n/a |
| file:test-extra-channels.ts | PASS | 4.3 | 21 | archive.org | 0 | n/a |
| file:test-fox-clips.ts | PASS | 2.7 | 0 | none | 0 | n/a |
| file:test-infobattalion-lists.ts | PASS | 6.3 | 37 | archive.org | 0 | yes |
| file:test-library-integrity.js | PASS | 2.7 | 7 | archive.org | 0 | yes |
| file:test-live-health.ts | PASS | 1.3 | 0 | none | 0 | yes |
| file:test-live-news-channels.ts | PASS | 2.2 | 0 | none | 0 | yes |
| file:test-live-radio-query.ts | PASS | 1.7 | 0 | none | 0 | yes |
| file:test-live-tv.ts | PASS | 10.2 | 11 | none | 0 | n/a |
| file:test-movies-classics.js | FAIL | 2.2 | 0 | none | 0 | n/a |
| file:test-news-ready-notice.ts | PASS | 2.6 | 7 | archive.org | 2 | yes |
| file:test-nova-canonical.js | PASS | 1.3 | 0 | none | 0 | yes |
| file:test-old-british-tv.ts | PASS | 1.7 | 0 | none | 0 | n/a |
| file:test-organizer-output.ts | FAIL | 3.2 | 14 | archive.org | 0 | n/a |
| file:test-pluto-epg.ts | PASS | 1.3 | 0 | none | 0 | yes |
| file:test-podcasts.ts | PASS | 1.3 | 0 | none | 0 | n/a |
| file:test-schedule-window.ts | PASS | 1.2 | 0 | none | 0 | n/a |
| file:test-science-guide.ts | PASS | 2 | 0 | none | 0 | yes |
| file:test-series.ts | PASS | 1.4 | 0 | none | 0 | n/a |
| file:test-source-ajn-audio.ts | PASS | 1.3 | 0 | none | 0 | n/a |
| file:test-source-ajn-media.ts | PASS | 1.3 | 0 | none | 0 | n/a |
| file:test-source-contracts.ts | PASS | 1.4 | 0 | none | 0 | n/a |
| file:test-western-death-valley.ts | PASS | 1.2 | 0 | none | 0 | n/a |
| script:test:epg-identity-producers | PASS | 1.7 | 0 | none | 0 | n/a |
| script:test:epg-program-lifecycle | PASS | 1.7 | 0 | none | 0 | n/a |
| script:test:ajn-rss-canonical | PASS | 1.8 | 0 | none | 0 | n/a |
| script:test:library-integrity | PASS | 3.3 | 7 | archive.org | 0 | yes |
| script:test:nova-canonical | PASS | 3.6 | 0 | none | 0 | yes |
| script:test:movies-classics | FAIL | 2.6 | 0 | none | 0 | n/a |
| script:test:old-british-tv | PASS | 2 | 0 | none | 0 | n/a |
| script:test:daily-rotation | PASS | 2.6 | 0 | none | 0 | n/a |
| script:test:source-contracts | PASS | 1.9 | 0 | none | 0 | n/a |
| script:test:cable-news-guide | FAIL | 3.4 | 0 | none | 0 | n/a |
| script:test:science-guide | PASS | 2.8 | 0 | none | 0 | yes |
| script:test:live-tv | PASS | 9.8 | 10 | none | 0 | n/a |
| script:test:source-ajn-audio | PASS | 2.2 | 0 | none | 0 | n/a |
| script:test:source-ajn-media | PASS | 1.6 | 0 | none | 0 | n/a |
| script:test:live-health | PASS | 2.9 | 0 | none | 0 | yes |
| script:test:discovery | PASS | 1.6 | 0 | none | 0 | yes |
| script:test:canonical-slice | PASS | 2 | 0 | none | 0 | yes |
| script:test:rumble | PASS | 5.2 | 0 | none | 0 | n/a |
| verifykit:self-test | PASS | 3.8 | 0 | none | 0 | yes |
| file:test-ajn-audio-canonical.js | PASS | 1.3 | 0 | none | 0 | n/a |
| file:test-program-store-bounded.ts | PASS | 55.9 | 41 | anchor.fm, archive.org, feeds.captivate.fm, feeds.megaphone.fm, listen.warroom.org, omny.fm, rss.libsyn.com | 0 | no |
| script:test:ajn-audio-canonical | PASS | 1.7 | 0 | none | 0 | n/a |
| script:test:program-store-bounded | PASS | 54.1 | 41 | anchor.fm, archive.org, feeds.captivate.fm, feeds.megaphone.fm, listen.warroom.org, omny.fm, rss.libsyn.com | 0 | yes |

Raw stdout/stderr and request paths were held transiently in memory only; only SHA-256, counts, hostnames, and exit classifications are retained.

## Changed files in this drop-in

- `server/data/liveTvPinned.json`
- `server/sources/liveTv.ts`
- `testFixtures/liveTvPinned.ts`
- `test-live-tv.ts`
- `test-live-tv-api-server.ts`
- `test-live-health.ts`
- `tools/ajn-verify/run.mjs`
- `tools/ajn-verify/registry.json`
- `tools/ajn-verify/self-test.mjs`

## Not verified / limits

- Real NTD stream playback, current upstream M3U refresh, and logo availability are not verified; the source test used synthetic fixtures.
- No external Archive request, playback, or production deployment was performed.

## Rollback

Remove `server/data/liveTvPinned.json` and `testFixtures/liveTvPinned.ts`; restore `server/sources/liveTv.ts`, `test-live-tv.ts`, `test-live-tv-api-server.ts`, and `test-live-health.ts` from the prior J1 base. Restore `tools/ajn-verify/run.mjs`, `registry.json`, and `self-test.mjs` from the J1 kit, including the pre-reseed self-test ledger hash.

## NEXT BUILD OUTLINE

- J3: Classic Hits 109 family — nine stations, a separate compact station strip, previous/next station behavior, and existing AJN Daily News Digest reuse.
- Inspect the radio dock, player station panel, station data, now-playing adapter, presets, and current tests before implementation.
- Keep audio stations out of the audio-podcasts guide schedule; do not change the user preset row.
- Probe only within J3’s request allowance; stop on provider throttles or failures.
- Add only the three missing station records and append-only station numbers; reuse existing playback and digest paths.
- Tests: CH109 ordering, wraparound, append-only numbers, preset preservation, and one shared digest fetch.
- Verify requested responsive screenshots, focused tests, and offline Cloud Run smoke.
- I will NOT re-test: Phase 1/2, captions/ASR, buffer gauge/read-ahead, visualizer, Archive proxy slices, Classic TV schedule, or other J2 paths not changed here.
