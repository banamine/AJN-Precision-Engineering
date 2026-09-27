# AJN Google Builder Drop-in — PR #7

Verified GitHub head:
`e8a53e026e8b71c2b6de6703db800c230e1f6ff3`

Purpose:
- Remove forced `crossOrigin="anonymous"` from AJN video/audio elements.
- Preserve existing Archive fallback and playback logic.
- Include the Archive CORS CI regression guard.

Apply by replacing the matching paths in the project:
- src/MinimalPlayer.tsx
- scripts/test-archive-cors-regression.js
- package.json
- .github/workflows/ajn-ci.yml

Do not copy `dist/` or `node_modules/` from elsewhere.

GitHub CI for this SHA passed TypeScript, production build, playback, audio bridge, AudioContext singleton, and Archive CORS guard.
Google Builder runtime still needs the final four-surface smoke test:
News → Classic TV → Audio → Archive.
