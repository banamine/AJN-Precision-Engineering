# Google Builder combined drop-in 2026-10-20
ZIP sha256 240a3ce932838dc5e44244884d530a8fc7634b7c7116e6176a2da14a9f4b1e3b (159,681 B), 52 files (23 replace, 29 new) + delete src/components/AudioAsrTranscriptPanel.tsx.
= all-in-one (P2 + captions + G17 + G18B) + RADIOCAPTIONS + AUDIOSLIM + one test-only fix (test-music-schedule-budget.mjs counts only timed Classic programs; 619 untimed ajn-allmychildren-extras rows are not in XMLTV by design).
BASE for Replit from now on: owner export + this ONE overlay (apply files, then delete AudioAsrTranscriptPanel.tsx). Equivalent to export + all-in-one + RadioCaptions + AudioSlim.
Claude verified offline: build OK; smoke exit 0; see extracted/INSTALL.txt.
