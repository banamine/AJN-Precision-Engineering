# AJN daily frames (Home "Today on AJN")

Needs on the PC: Python 3, `pip install pillow`, and ffmpeg/ffprobe on PATH (`ffmpeg -version`).

    python tools/daily-frames/daily_frames.py extract            # today's videos (UTC date); --date 20261009 for another day
    # open tools/daily-frames/work/<date>/review.html, click the frames to keep, press "Export decisions"
    python tools/daily-frames/daily_frames.py publish --decisions "%USERPROFILE%\Downloads\decisions.json"
    # commit public/daily/ (jpgs + manifest.json) and tools/daily-frames/rejected.json, push, deploy

- Frames come from real video URLs over HTTP range requests (no full downloads, ~8 s per video).
- Black/washed-out/blurry frames are dropped automatically; the counts are printed.
- Frames you did NOT tick are remembered by fingerprint (rejected.json) and hidden on later days.
- Failures are printed per video/timestamp; nothing is invented. No manifest = Home hides the section.
- `work/` is scratch; do not commit it.
