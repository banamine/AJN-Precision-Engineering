# AJN Google Drop-in Playback Fix

## Purpose

This branch is a surgical playback repair based on the current `main` branch of `banamine/AJN-Precision-Engineering`.

It does **not** import Replit/Google reference architecture, add a second player, change the EPG, or replace the Archive proxy implementation.

## Files changed

- `src/MinimalPlayer.tsx`
- No other application source files are required for the playback change.

## Fix

The current schedule path supplies Archive media as:

`/api/archive/proxy?path=/download/<identifier>/<actual-file>`

The player previously waited for a proxy media decode error and then performed a second transport fallback. The repaired player canonicalizes a validated Archive `/download/` path to the direct Archive transport before assigning it to native `<video>`.

Validation rules:

- path must begin with `/download/`
- embedded schemes are rejected
- traversal sequences are rejected
- no new URL is invented from an identifier
- native HTML5 `<video>` remains the only playback element

## Why

Direct native Archive playback has already been proven in the project test harness. The current GitHub baseline was still introducing an additional proxy/fallback transport at the player boundary.

This patch removes that transport ambiguity while leaving discovery, scheduling, EPG, navigation, and server proxy code untouched.

## Google Builder execution

1. Update GitHub from branch `fix/archive-native-playback-dropin-20260906`.
2. Build the existing application:
   `npm run build`
3. Deploy the normal application.
4. Open TV Guide.
5. Test, in order:
   - Fox News
   - CNN
   - MSNBC
   - BBC News
6. Capture browser console and Network evidence.

## PASS criteria

For each selected program:

- the player receives a non-empty source
- source resolves to `https://archive.org/download/...` when the schedule supplied the validated proxy path
- `video.readyState >= 3`
- `currentTime` advances
- `video.error === null` while playing
- real video frames are visible
- audio is present when the source contains audio
- selecting the next program replaces the prior media cleanly

## STOP conditions

Do not add:

- HLS.js
- another video player
- a new Archive proxy
- `news.json`
- 353-clip/chunk scheduling
- arbitrary timeout increases
- fabricated `<identifier>.mp4` URLs

If playback still fails, preserve the branch and collect the exact source URL plus the Network response before changing another file.

## Baseline

Parent: `main`

Fix commit:

`b18e1e3e0c2a9cbaf753e1511760999ea9111923`

Branch:

`fix/archive-native-playback-dropin-20260906`
