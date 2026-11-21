# Transcript fix + reading view (2026-11-21)
Drop each file at the same path in the repo (all based on the 7:34 AM export).

What was wrong: the server only knows an episode's address after the guide has loaded the feeds. After a new deploy (or if you play a restored episode first) it answered "unknown", and the app showed that as "No transcript" / "Feed length unavailable".
Fix: the server now loads the feeds (up to 16 s) before saying unknown, the app no longer calls an unknown episode "no transcript" (it says "The server has not listed this episode yet: retrying…" and retries 6 times), and the news card is height-capped so Prev/Next always show.
Reading view: current line big, bold, green, centred, 2 lines before and 2 after.

Check: play The Kuhner Report episode, open the full player. Captions appear within seconds. DevTools > Network: /api/podcast/transcript returns 200.
