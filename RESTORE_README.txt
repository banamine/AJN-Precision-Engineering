AJN APP RESTORE — ENTRYPOINT ONLY

Purpose:
Restore the real React AJN application after the temporary two-file native
Archive playback test replaced the application entrypoint.

DROP-IN:
    index.html

This file restores the normal React bootstrap:
    index.html
        -> /src/main.tsx
        -> App.tsx
        -> existing AJN application

IMPORTANT:
- Do NOT install the two-file native playback demo as the application.
- Do NOT replace App.tsx, server.ts, channels.ts, archive-discovery.ts,
  PlayerView.tsx, or MinimalPlayer.tsx as part of this restore.
- This package intentionally restores only the application entrypoint.
- After replacement, run the existing build/type checks.

Expected first verification:
1. The AJN application shell returns.
2. Home / TV Guide / Player / Library / Search are available according
   to the current application build.
3. The native two-file test page is gone.
4. No playback transport changes are made by this restore.

Source baseline:
AJN-Media-Console GitHub main branch index.html.
