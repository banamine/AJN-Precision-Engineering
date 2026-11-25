/* Checks the podcast feeds added on 2026-11-25 with the app's own reader (title match, playable HTTPS audio, newest date).
 * Run from the repo folder (needs internet):  npx tsx tools/verify-new-podcasts.ts
 * Prints one line per show and writes tools/verify-new-podcasts.report.txt. Changes nothing. */
import { writeFileSync } from 'node:fs';
import { PODCAST_SOURCES, refreshPodcastSource } from '../server/podcasts';
const list = PODCAST_SOURCES.filter((s) => (s as { addedFrom?: string }).addedFrom);
const rows: string[] = []; let ok = 0;
let next = 0;
async function worker() {
  for (;;) {
    const s = list[next++]; if (!s) return;
    const t0 = Date.now();
    try {
      const st = await refreshPodcastSource(s);
      const newest = st.episodes.length ? new Date(Math.max(...st.episodes.map((e) => e.publishedAt))).toISOString().slice(0, 10) : '-';
      const good = st.episodes.length > 0; if (good) ok++;
      rows.push(`${good ? 'OK  ' : 'FAIL'} | ${s.id} | episodes ${st.episodes.length} | newest ${newest} | feed title "${st.feedTitle ?? ''}" | ${st.error ?? ''} | ${Date.now() - t0} ms`);
    } catch (e) { rows.push(`FAIL | ${s.id} | ${(e as Error).message}`); }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
rows.sort();
const out = rows.join('\n') + `\n\n${ok} of ${list.length} OK\n`;
console.log(out); writeFileSync('tools/verify-new-podcasts.report.txt', out);
