# Drop-in 2026-10-10 (2): Rush/Archive channels survive a bad boot; podcasts blocked by tracker hosts now play

Unzip over the repo root. Files: guideRegistry.ts, server.ts, server/rush.ts, server/safeFetch.ts, server/podcasts.ts, src/MinimalPlayer.tsx, src/utils/mediaRoute.ts, test-podcast-resolve.ts, test-rush-retry.ts.

## 1. Lost Rush / Old-Time Radio channels
Root cause (from your AI Studio log): at boot Archive answered 502 / ECONNRESET ("[Audio] OTR OTR search HTTP 502", "wnbc-1975 metadata HTTP 502", "long-john-nebel fetch failed"). The audio build cached that empty result for the WHOLE UTC day, so the channels stayed gone, and the new Archive channels competed with Rush for the Archive limiter at boot.
Fix: (a) a build with any empty channel is retried after 90 s (last good rows stay visible meanwhile); only a complete build holds for the day; (b) Rush + OTR resolve first, the whole-item channels one at a time after; (c) Archive metadata lookups retry 2x on 5xx/429/network errors (404 is not retried).

## 2. New podcasts that did not play (Tucker, Trish Regan, Ben Ferguson)
Evidence from your log: every failing show has mgln.ai + pscrb.fm in its tracker chain and failed in native mode too (so not a CORS problem); Fox (no mgln/pscrb) and Savage play. Strong sign your browser/network blocks those tracker hosts.
Fix: new GET /api/podcast/resolve?url=<enclosure>. When a podcast file fails with MediaError 4, the player says "Loading… (resolving the redirect chain on the server)", the server walks the same chain (trackers still count the download), and the browser plays the signed CDN URL directly. Audio is never proxied. Only enclosure URLs from our own feeds are accepted (404 otherwise); every hop is SSRF-checked; up to 14 hops.
Verified here: resolves Tucker (8 hops), Trish Regan and Ben Ferguson to dcs-spotify.megaphone.fm / tritondigital URLs.
Note: the server, not the listener, hits the trackers in this fallback (listener IP/geo is not reported to them).

Verify: npx tsc --noEmit; npx tsx test-podcast-resolve.ts; npx tsx test-rush-retry.ts. Live: open Tucker; expect a brief "resolving" status then audio; DevTools Network shows a dcs-*.megaphone.fm request.
