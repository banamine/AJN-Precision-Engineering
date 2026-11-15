// Run: npx tsx server/thirdEye/thirdEye.test.ts
// Fixture rows are real Third Eye rows from 2026-11-14 (copied from the owner's PowerShell output) plus clearly marked synthetic cases.
import { test } from 'node:test';
import assert from 'node:assert';
import { buildStories, cleanLines, parseThirdEyeTsv } from './core.js';
import { createThirdEyeService } from './service.js';

const H = 'date_time_(UTC)\tchannel\tduration\thttps://archive.org/details/\ttext\n';
const row = (t: string, ch: string, d: number, id: string, s: number, text: string) => `${t}\t${ch}\t${d}\t${id}/start/${s}\t${text}\n`;
// REAL rows
const REAL =
  row('2026-11-14 00:00:00', 'FOXNEWSW', 44, 'FOXNEWSW_20261113_230000_Special_Report_With_Bret_Baier', 3600, 'FAA ISSUES NATIONWIDE GROUND STOP\\nFAA ISSUES NATIONWIDE GROUND STOP FOR AI.L FLIGHTS') +
  row('2026-11-14 00:01:00', 'FOXNEWSW', 28, 'FOXNEWSW_20261114_000000_The_Ingraham_Angle', 60, 'FAA ISSUES NATIONWIDE GROUND STOP FOR AI.L FLIGHTS') +
  row('2026-11-14 00:01:00', 'CNNW', 47, 'CNNW_20261114_000000_Erin_Burnett_OutFront', 60, 'NATIONWIDE GROUND STOP ENTERS 4TH HOUR WITH NO END IN SIGHT\\nFAA NATIONWIDE GROUND STOP DUE TO \\"EXTRAORDINARY CIRCUMSTANCES\\') +
  row('2026-11-14 00:02:00', 'CNNW', 62, 'CNNW_20261114_000000_Erin_Burnett_OutFront', 120, 'FAA NATIONWIDE GROUND STOP DUE TO \\"EXTRAORDINARY CIRCUMSTANCES\\') +
  row('2026-11-14 00:01:00', 'BBCNEWS', 56, 'BBCNEWS_20261114_000000_BBC_News', 60, 'FAA: All US flights grounded for reasons of safety') +
  row('2026-11-14 00:02:00', 'BBCNEWS', 54, 'BBCNEWS_20261114_000000_BBC_News', 120, 'FAA: All US flights grounded for reasons of safety\\nChief Presenter. B EME NEWS') +
  row('2026-11-14 00:01:00', 'MSNOW', 7, 'MSNOW_20261114_000000_The_Weeknight', 60, 'TRUMP ADMIN UPDATE ON FAA GROUND STOP EAPECITE. . TIVE S 7:O4 eΓä™ P I |\\n1 IVE > 7OO\\"V') +
  row('2026-11-14 00:02:00', 'MSNOW', 9, 'MSNOW_20261114_000000_The_Weeknight', 120, 'TRUMP ADMIN UPDATE ON FAA GROUND STOP EAPECITE. . TIVE S 4:O3 FM P i |');

test('parser: header required, columns mapped, bad body rejected', () => {
  assert.strictEqual(parseThirdEyeTsv('<div>bad arg</div>'), null);
  const rows = parseThirdEyeTsv(H + REAL)!;
  assert.strictEqual(rows.length, 8);
  assert.deepStrictEqual([rows[0].channel, rows[0].identifier, rows[0].startSec, rows[0].durationSec], ['FOX', 'FOXNEWSW_20261113_230000_Special_Report_With_Bret_Baier', 3600, 44]);
});

test('cleanLines: literal \\n split, ". . " tail cut, escaped quotes, junk and ad lines dropped', () => {
  assert.deepStrictEqual(cleanLines('FAA ISSUES NATIONWIDE GROUND STOP\\nFAA ISSUES NATIONWIDE GROUND STOP FOR AI.L FLIGHTS', 'FOX'), ['FAA ISSUES NATIONWIDE GROUND STOP', 'FAA ISSUES NATIONWIDE GROUND STOP FOR AI.L FLIGHTS']);
  assert.deepStrictEqual(cleanLines('TRUMP ADMIN UPDATE ON FAA GROUND STOP EAPECITE. . TIVE S 7:O4 P I |', 'MS NOW'), ['TRUMP ADMIN UPDATE ON FAA GROUND STOP EAPECITE']);
  assert.deepStrictEqual(cleanLines('FAA NATIONWIDE GROUND STOP DUE TO \\"EXTRAORDINARY CIRCUMSTANCES\\"', 'CNN'), ['FAA NATIONWIDE GROUND STOP DUE TO "EXTRAORDINARY CIRCUMSTANCES"']);
  assert.deepStrictEqual(cleanLines('Not approved for elderly patients with dementia-related psychosis. due to risk', 'CNN'), []);   // mixed case on a caps channel = ad copy
  assert.deepStrictEqual(cleanLines('CALL FOR YOUR FREE TIMESHARE EXIT KIT', 'FOX'), []);                                          // commercial
  assert.deepStrictEqual(cleanLines('Chief Presenter. B EME NEWS', 'BBC'), []);                                                   // BBC logo tail
  assert.deepStrictEqual(cleanLines('US flight delays and cancellations after ground stop', 'BBC'), ['US flight delays and cancellations after ground stop']); // BBC mixed case is normal
  assert.deepStrictEqual(cleanLines('A B C', 'CNN'), []);                                                                           // under 4 words
});

test('stories: the four-channel ground-stop story merges into ONE item with per-channel wording', () => {
  const stories = buildStories(parseThirdEyeTsv(H + REAL)!);
  const big = stories.filter((s) => s.channels.length === 4);
  assert.strictEqual(big.length, 1, JSON.stringify(stories.map((s) => [s.channels, s.text])));
  assert.deepStrictEqual([...big[0].channels].sort(), ['BBC', 'CNN', 'FOX', 'MS NOW']);
  assert.strictEqual(big[0].variants.length, 4);
  assert.strictEqual(big[0].tsMs, Date.parse('2026-11-14T00:00:00Z'));   // earliest time
  assert.ok(big[0].identifier && big[0].startSec >= 0);                  // usable for /api/captions
});

test('stories: durations under 6 s, singletons seen once briefly, and ads never become stories', () => {
  const tsv = H
    + row('2026-11-14 01:00:00', 'CNNW', 4, 'CNNW_20261114_010000_X', 0, 'SYNTHETIC HEADLINE SHOWN FOR FOUR SECONDS ONLY')
    + row('2026-11-14 01:05:00', 'CNNW', 12, 'CNNW_20261114_010000_X', 300, 'SYNTHETIC ONE OFF OCR GARBAGE LINE ZZQX')
    + row('2026-11-14 01:10:00', 'CNNW', 30, 'CNNW_20261114_010000_X', 600, 'SYNTHETIC HEADLINE ON SCREEN FOR MANY MINUTES')
    + row('2026-11-14 01:11:00', 'CNNW', 30, 'CNNW_20261114_010000_X', 660, 'SYNTHETIC HEADLINE ON SCREEN FOR MANY MINUTES');
  const texts = buildStories(parseThirdEyeTsv(tsv)!).map((s) => s.text);
  assert.deepStrictEqual(texts, ['SYNTHETIC HEADLINE ON SCREEN FOR MANY MINUTES']);
});

test('service: ok, then stale (not new) after a failed refresh, and a non-table body is an explicit failure', async () => {
  let t = Date.parse('2026-11-14T12:00:00Z'); let mode: 'ok' | 'html' | 'http' = 'ok'; let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (mode === 'http') return new Response('nope', { status: 503 });
    return new Response(mode === 'ok' ? H + REAL : '<div>bad arg</div>', { status: 200 });
  }) as typeof fetch;
  const svc = createThirdEyeService({ fetchImpl, now: () => t });
  const first = await svc.get({ hours: 48, q: '', channel: '', limit: 10 });
  assert.strictEqual(first.status, 'ok');
  assert.ok(first.items.length >= 1 && first.generatedAt === new Date(t).toISOString());
  const t0 = t; t += 11 * 60_000; mode = 'html';
  const stale = await svc.get({ hours: 48, q: '', channel: '', limit: 10 });
  assert.strictEqual(stale.status, 'stale');
  assert.strictEqual(stale.generatedAt, new Date(t0).toISOString());     // last SUCCESS, not "now"
  assert.match(String(stale.staleReason), /did not return a table/);
  assert.ok(stale.items.length >= 1);                                    // last good data still served, labelled
  const q = await svc.get({ hours: 48, q: 'ground stop', channel: 'BBC', limit: 10 });
  assert.ok(q.items.every((s) => s.channels.includes('BBC')));
  const fresh = createThirdEyeService({ fetchImpl: (async () => new Response('x', { status: 503 })) as typeof fetch, now: () => t });
  const none = await fresh.get({ hours: 24, q: '', channel: '', limit: 5 });
  assert.strictEqual(none.status, 'unavailable');                        // nothing cached: explicit error, no empty "success"
  assert.ok(calls >= 2);
});
