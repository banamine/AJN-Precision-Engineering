# AJN Precision Engineering — Google AI Studio drop-in

Source: GitHub banamine/AJN-Precision-Engineering, main (merge of fix/p1 @ 3642150). CI green.

## Load
1. AI Studio → Back to start → **New app** (not Remix, not an existing app).
2. Upload this ZIP. Files must sit at the top level (server.ts, package.json, src/).
3. No environment variables or secrets are needed. Decline any prompt for DIRECTUS_*, DATABASE_URL, BASE_PATH, STATIC_ROOT.
4. Check: open `/api/guides` in the preview → it must list `live-tv`.

## Rules for the builder
- Edit only files you are asked to edit. Do not press "Fix" on anything.
- One pipeline: sources (server/sources/*) → guide (guideRegistry.ts) → /api/archive/proxy → src/MinimalPlayer.tsx.
- Archive links are used exactly as given. No fallback/demo media.
- Push from GitHub/PC, not from AI Studio.
