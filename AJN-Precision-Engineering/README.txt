AJN SIMPLE TWO-FILE PLAYBACK TEST

Purpose:
Prove whether the browser can play two known Archive.org MP4 sources without any AJN application layer.

The page intentionally uses only:
  HTML <video>
  video.src
  video.load()
  video.play()

It does NOT use:
  /api/archive/proxy
  server.ts
  HLS.js
  MediaSource
  AudioBridge
  EPG
  schedule generation
  chunking
  URL rewriting

Test:
1. Open index.html from a web origin (localhost is preferable).
2. Click "Play Big Buck Bunny test".
3. Confirm video and audio play.
4. Click "Play FOX News test".
5. Confirm video and audio play.
6. If either fails, copy the status box and browser Console/Network error.

IMPORTANT:
A file:// URL may be restricted by browser security/CORS behavior. For a clean test,
serve this directory with any simple static HTTP server, e.g.:
  python -m http.server 8080
Then open:
  http://localhost:8080/

The two source URLs are embedded exactly as supplied.
