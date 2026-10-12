import * as fs from 'node:fs';
const ch: Array<{ itemId: string }> = JSON.parse(fs.readFileSync('src/data/archiveAudioChannels.json', 'utf8'));
const snap = JSON.parse(fs.readFileSync('src/data/audioItemSnapshot.json', 'utf8'));
let fail = 0; const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('FAIL', m); } };
for (const id of new Set(ch.map((c) => c.itemId))) {
  const e = snap.items[id];
  ok(!!e && e.files.length > 0, `snapshot has ${id}`);
  for (const f of e?.files ?? []) { ok(/\.mp3$/i.test(f.file) && f.durationSeconds > 0, `${id}: ${f.file} valid`); }
}
console.log(fail ? `audio snapshot: ${fail} failure(s)` : 'audio snapshot: all passed');
process.exit(fail ? 1 : 0);
