// Guards tools/catalog-gate.mjs: the nightly catalog refresh may only auto-merge additive, bounded, in-budget changes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, summaryMarkdown } from './tools/catalog-gate.mjs';

const config = JSON.parse(readFileSync('config/catalog-refresh.json', 'utf8'));
const row = (identifier, file = 'a.mp4') => ({ id: `${identifier}-${file}`, identifier, file, title: identifier, bytes: 1, durationSeconds: 1200, thumb: null });
const chan = (id, rows, extra = {}) => ({ guideId: 'classic-tv', id, name: id, group: 'Classic TV', deferLightRows: true, rows, ...extra });
const okMeasure = { classicLightBytes: 1_000_000, classicFullBytes: 33_000_000, classicFullGzipBytes: 3_000_000, guideMB: { 'movies-classics-vault': 0.2, 'cable-tv': 2.1, 'science-documentaries': 3.7 } };
const base = { extra: { channels: [chan('tvx-a', [row('a1'), row('a2')])] }, docs: [{ g: 'G', id: 'd1', u: 'u1' }], audio: [{ id: 'otr-x', name: 'X' }] };
const clone = (v) => JSON.parse(JSON.stringify(v));

// Unchanged -> none
assert.equal(evaluate(base, clone(base), okMeasure, config).verdict, 'none');

// Additive and small -> auto
const add = clone(base);
add.extra.channels.push(chan('tvx-b', [row('b1')]));
add.extra.channels[0].rows.push(row('a3'));
add.docs.push({ g: 'New', id: 'd2', u: 'u2' });
let r = evaluate(base, add, okMeasure, config);
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
assert.equal(evaluate(base, add, { ...okMeasure, classicLightBytes: 1_900_000 }, config).verdict, 'review');
assert.equal(evaluate(base, add, { ...okMeasure, classicLightBytes: 2_200_000 }, config).verdict, 'block');
assert.equal(evaluate(base, add, { ...okMeasure, guideMB: { ...okMeasure.guideMB, 'cable-tv': 4.5 } }, config).verdict, 'block');
assert.equal(evaluate(base, add, null, config).verdict, 'block');
assert.equal(evaluate(base, add, { ...okMeasure, classicFullGzipBytes: 40_000_000 }, config).verdict, 'block');

// Summary renders the verdict and counts
const md = summaryMarkdown(evaluate(base, add, okMeasure, config));
assert.match(md, /Catalog refresh: \*\*AUTO\*\*/);
assert.match(md, /\| channels \| 1 \| 0 \|/);

console.log('PASS catalog-gate: none/auto/review/block verdicts, removals, renames, moves, limits, lazy-load, budgets');
