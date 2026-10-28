// Guards tools/catalog-gate.mjs: the nightly catalog refresh may only auto-merge additive, bounded, in-budget changes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, summaryMarkdown } from './tools/catalog-gate.mjs';
import { newTargets, judge, applyFailures, probe, rowUrl } from './tools/catalog-probe.mjs';

const config = JSON.parse(readFileSync('config/catalog-refresh.json', 'utf8'));
const row = (identifier, file = 'a.mp4') => ({ id: `${identifier}-${file}`, identifier, file, title: identifier, bytes: 1, durationSeconds: 1200, thumb: null });
const chan = (id, rows, extra = {}) => ({ guideId: 'classic-tv', id, name: id, group: 'Classic TV', deferLightRows: true, rows, ...extra });
const okMeasure = { classicLightBytes: 1_000_000, classicFullBytes: 33_000_000, classicFullGzipBytes: 3_000_000, guideMB: { 'movies-classics-vault': 0.2, 'cable-tv': 2.1, 'science-documentaries': 3.7 } };
const base = { extra: { channels: [chan('tvx-a', [row('a1'), row('a2')])] }, docs: [{ g: 'G', id: 'd1', u: 'u1' }], audio: [{ id: 'otr-x', name: 'X' }] };
const clone = (v) => JSON.parse(JSON.stringify(v));
const okProbe = { targets: 3, probed: 3, ok: 3, failed: [], unprobed: 0, stoppedAt: null };

// Unchanged -> none
assert.equal(evaluate(base, clone(base), okMeasure, config).verdict, 'none');

// Additive and small -> auto
const add = clone(base);
add.extra.channels.push(chan('tvx-b', [row('b1')]));
add.extra.channels[0].rows.push(row('a3'));
add.docs.push({ g: 'New', id: 'd2', u: 'u2' });
let r = evaluate(base, add, okMeasure, config, okProbe);
assert.equal(r.verdict, 'auto', r.reasons.join('; '));
assert.equal(r.counts.addedChannels, 1);
assert.equal(r.counts.addedRows, 2);
assert.equal(r.counts.addedDocs, 1);
assert.equal(r.counts.newDocGroups, 1);

// Removed channel / removed rows -> review
const removed = clone(base); removed.extra.channels = [];
assert.equal(evaluate(base, removed, okMeasure, config).verdict, 'review');
const shrunk = clone(base); shrunk.extra.channels[0].rows.pop();
r = evaluate(base, shrunk, okMeasure, config);
assert.equal(r.verdict, 'review');
assert.match(r.reasons.join(' '), /row\(s\) removed/);

// Rename and guide move -> review
const renamed = clone(base); renamed.extra.channels[0].name = 'Other';
assert.equal(evaluate(base, renamed, okMeasure, config).verdict, 'review');
const moved = clone(base); moved.extra.channels[0].group = 'Cartoons';
assert.equal(evaluate(base, moved, okMeasure, config).verdict, 'review');

// Too many new channels -> review
const many = clone(base);
for (let i = 0; i < config.autoMerge.maxNewChannels + 1; i++) many.extra.channels.push(chan(`tvx-n${i}`, [row(`n${i}`)]));
assert.match(evaluate(base, many, okMeasure, config).reasons.join(' '), /new channels > limit/);

// New Classic TV channel that is not lazy-loaded -> review
const eager = clone(base); eager.extra.channels.push(chan('tvx-eager', [row('e1')], { deferLightRows: undefined }));
assert.match(evaluate(base, eager, okMeasure, config).reasons.join(' '), /not lazy-loaded/);

// Budgets: above ceiling -> review; above hard limit -> block; missing measurement -> block
assert.equal(evaluate(base, add, { ...okMeasure, classicLightBytes: 1_900_000 }, config, okProbe).verdict, 'review');
assert.equal(evaluate(base, add, { ...okMeasure, classicLightBytes: 2_200_000 }, config, okProbe).verdict, 'block');
assert.equal(evaluate(base, add, { ...okMeasure, guideMB: { ...okMeasure.guideMB, 'cable-tv': 4.5 } }, config, okProbe).verdict, 'block');
assert.equal(evaluate(base, add, null, config, okProbe).verdict, 'block');
assert.equal(evaluate(base, add, { ...okMeasure, classicFullGzipBytes: 40_000_000 }, config, okProbe).verdict, 'block');

// Summary renders the verdict and counts
const md = summaryMarkdown(evaluate(base, add, okMeasure, config, okProbe));
assert.match(md, /Catalog refresh: \*\*AUTO\*\*/);
assert.match(md, /\| channels \| 1 \| 0 \|/);

// Probe outcome gates auto-merge
assert.match(evaluate(base, add, okMeasure, config).reasons.join(' '), /probe did not run/);
assert.match(evaluate(base, add, okMeasure, config, { ...okProbe, probed: 2, unprobed: 1, stoppedAt: { index: 2, status: 429 } }).reasons.join(' '), /not probed .*429/);
assert.match(evaluate(base, add, okMeasure, config, { ...okProbe, ok: 2, failed: [{}] }).reasons.join(' '), /failed the playability probe/);

// Probe helpers
const targets = newTargets(base, add);
assert.deepEqual(targets.map((t) => t.kind).sort(), ['doc', 'row', 'row']);
assert.equal(rowUrl({ identifier: 'my item', file: 'dir/A & B.mp4' }), 'https://archive.org/download/my%20item/dir/A%20%26%20B.mp4');
assert.deepEqual(judge(206, 'video/mp4'), { ok: true });
assert.equal(judge(200, 'text/html; charset=utf-8').ok, false);
assert.equal(judge(403, 'video/mp4').ok, false);
const pruned = applyFailures(base, add, ['b1/a.mp4', 'a3/a.mp4']);
assert.deepEqual(pruned.droppedChannels, ['tvx-b'], 'a new channel whose only row failed is dropped');
assert.equal(pruned.extra.channels.find((c) => c.id === 'tvx-a').rows.length, 2, 'existing channel keeps its old rows, loses the failed new one');

const answers = { 0: [206, 'video/mp4'], 1: [404, 'text/html'], 2: [206, 'video/mp4'] };
let calls = 0;
const fakeFetch = async () => { const [status, type] = answers[calls++]; return new Response('x', { status, headers: { 'content-type': type } }); };
let result = await probe(targets, { fetchImpl: fakeFetch, sleep: async () => {} });
assert.equal(result.ok, 2); assert.equal(result.failed.length, 1); assert.equal(result.failed[0].reason, 'HTTP 404'); assert.equal(result.unprobed, 0);
calls = 0;
const limited = async () => (calls++ === 0 ? new Response('x', { status: 206, headers: { 'content-type': 'video/mp4' } }) : new Response('slow down', { status: 429 }));
result = await probe(targets, { fetchImpl: limited, sleep: async () => {} });
assert.equal(result.probed, 1); assert.equal(result.unprobed, 2); assert.equal(result.stoppedAt.status, 429);

console.log('PASS catalog-gate: none/auto/review/block verdicts, removals, renames, moves, limits, lazy-load, budgets, playability probe');
