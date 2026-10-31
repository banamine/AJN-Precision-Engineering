// Measures the guide payloads the catalog gate budgets (tools/catalog-gate.mjs).
// Offline: Archive fetches are stubbed, so it measures what the committed manifests produce.
// Usage: npx tsx tools/catalog-measure.mts [out.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

process.env.NODE_ENV ??= 'test';
globalThis.fetch = (async () => new Response(
  JSON.stringify({ files: [], response: { docs: [] } }),
  { status: 200, headers: { 'content-type': 'application/json' } },
)) as typeof fetch;

const root = process.cwd();
const { getScheduleForGuide } = await import(path.join(root, 'guideRegistry.ts'));
const { buildClassicLightSchedule } = await import(path.join(root, 'server/classicLightSchedule.ts'));

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const classic = await getScheduleForGuide('classic-tv');
const light = buildClassicLightSchedule(classic, Date.now(), '0');
const guideMB: Record<string, number> = {};
for (const guideId of ['movies-classics-vault', 'cable-tv', 'science-documentaries']) {
  guideMB[guideId] = +(bytes(await getScheduleForGuide(guideId)) / 1048576).toFixed(3);
}
const result = {
  measuredAt: new Date().toISOString(),
  classicChannels: classic.length,
  classicDeferredChannels: classic.filter((c: { deferLightRows?: boolean }) => c.deferLightRows === true).length,
  classicLightBytes: bytes(light),
  classicFullBytes: bytes(classic),
  // What /api/schedule?guide=classic-tv actually sends: bodies above 28 MiB are always gzipped (server.ts).
  classicFullGzipBytes: gzipSync(JSON.stringify({ guideId: 'classic-tv', channels: classic }), { level: 5 }).length,
  guideMB,
};
const out = process.argv[2];
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
