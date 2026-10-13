/** Build src/data/seriesManifests.json: every episode of each series in collections/series-config.ts, read from Archive item
 *  metadata (links and lengths only, no media downloaded).  Run: npm run series:build   (then commit the JSON)
 *  Per episode the best browser-playable file is chosen (h.264 derivative > h.264 IA > MPEG4; never .avi).
 *  Anything that cannot be placed (no season/episode in the name, duplicate numbers, number gaps) is listed under "issues". */
import { writeFileSync, renameSync } from 'node:fs';
import { archiveApiFetch } from '../server/archiveLimiter';
import { fetchItemMetadata } from '../server/catalog/enumerate';
import { selectPlayableFile } from '../server/archive/mediaSelector';
import { findSexWord } from '../server/catalog/rules';
import { SERIES_CONFIG } from '../collections/series-config';
import { parseEpisodeName, groupEpisodes, buildManifest } from '../collections/series-parse';

const outUrl = new URL('../src/data/seriesManifests.json', import.meta.url);
const log = (s: string) => console.log(`[series] ${s}`);
const only = (process.env.SERIES || '').split(',').filter(Boolean);
const manifests: Record<string, unknown> = {};

for (const cfg of SERIES_CONFIG) {
  if (only.length && !only.includes(cfg.key)) continue;
  const items = [];
  for (const it of cfg.items) {
    const r = await fetchItemMetadata(archiveApiFetch, it.identifier);
    if (!r.ok) { items.push({ cfg: it, error: `metadata unavailable: ${(r as { ok: false; reason: string }).reason}` }); log(`${it.identifier}: metadata unavailable (${(r as { ok: false; reason: string }).reason})`); continue; }
    const md: any = r.meta.metadata;
    const hit = findSexWord({ title: md.title, description: md.description, subject: md.subject });
    if (hit) { items.push({ cfg: it, error: `excluded by SEX word rule (${hit})` }); continue; }
    items.push({ cfg: it, meta: r.meta });
  }
  const m = buildManifest(cfg, items, { parseEpisodeName, groupEpisodes, selectPlayableFile, findSexWord });
  manifests[cfg.key] = m;
  const bySeason = m.seasons.map((s) => `S${s.season}:${s.episodes}`).join(' ');
  log(`${cfg.key}: ${m.episodes.length} episodes (${bySeason}); ${m.issues.length} issue(s)`);
  for (const i of m.issues) log(`  issue: ${i}`);
}
const out = JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), series: manifests }, null, 1);
const tmp = new URL('../src/data/seriesManifests.json.tmp', import.meta.url);
writeFileSync(tmp, out); renameSync(tmp, outUrl);
log(`wrote src/data/seriesManifests.json (${(out.length / 1024).toFixed(0)} KB)`);
