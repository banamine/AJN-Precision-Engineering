---
name: ajn-help-support
description: Extended help and support for AJN users and testers — explain features in plain language, write in-app help text and FAQs, and turn user reports into reproducible bug tickets.
---

# AJN help & support

## Answering a user question
1. Identify the area (guide, player, search, archive, radio, playlists, health).
2. Answer in plain words, 3–6 sentences, with the exact clicks. No internal component names unless the user is a developer.
3. If the feature isn't verified working, say so honestly; don't promise.

## In-app help text
- One sentence what it does, one sentence how to use it, one line for the common problem.
- Error messages say what failed and what to try: "This video couldn't load from Archive.org (server busy). Try again in a minute or pick another channel."

## FAQ starters
- Why is a channel showing an error instead of playing? (source down; we show the truth instead of filler)
- Why are guide times blank? (source gave no air time)
- Why doesn't live status update? (only as fresh as last import)
- How do I add my own M3U?

## Turning a report into a ticket
```
Title: <area>: <symptom>
Env: URL, commit, browser, viewport, time UTC
Steps: 1..n
Expected / Actual
Evidence: screenshot, failing request URL + status, console lines
Frequency: always / sometimes (n of m)
```
