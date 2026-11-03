# AJN Slice A/B acceptance evidence

Captured against the accepted temporary source tree on localhost:5001; desktop viewport 1376x900 and mobile viewport 390x844. No application source was changed for these checks.

Screenshots are paired for these states: nothing playing; a real Classic Hits 109 stream playing; Radio panel open while the mini dock remains mounted; the #player route while live audio continues; dock dismissed with X; Radio reopened after X; and a Retry-visible media failure.

The actual LIVE pill computed to foreground rgb(15, 17, 23) and background rgb(239, 68, 68). The Retry case was produced by a real browser media-element error after the test browser refused the configured station host with net::ERR_CONNECTION_REFUSED; it is a controlled failure-UI check, not an upstream outage claim.

`dom/` contains the per-viewport measurements, button counts and media state. `review/Slice-A-B-git-diff-9b9c1e2.patch` is the exact five-file unified diff against base 9b9c1e2f8eaf051b7f4da53f70aaec7000029b2c.
