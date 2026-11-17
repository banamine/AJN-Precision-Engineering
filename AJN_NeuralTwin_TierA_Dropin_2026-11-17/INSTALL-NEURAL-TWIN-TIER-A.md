# Neural Twin Tier A - install
Copy these 4 files over your working copy (same paths), then publish:
- src/neural/topology.ts
- src/neural/telemetry.ts
- src/components/NeuralTwinView.tsx
- test-neural-twin.ts  (optional test)

Now wired to real signals: Library index, Mini player dock, Radio presets, Rocker keys, News Cube, Daily briefing.
Anything not read yet shows IDLE, never LIVE. Manifest ingest stays NOT WIRED (manifests have no timestamp).
Build notes: News Cube / Daily briefing show the digest story count after you press "Check digest now".
Test: npx tsx test-neural-twin.ts -> "neural twin ok 32 neurons".
