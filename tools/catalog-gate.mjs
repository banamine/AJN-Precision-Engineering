#!/usr/bin/env node
// Catalog refresh gate: compares the catalog data files at a base git ref with the working tree,
// checks payload measurements against config/catalog-refresh.json, and decides:
//   "none"   - nothing changed (no PR)
//   "auto"   - additive, small, within budget: safe to merge after CI passes
//   "review" - open the PR but leave it for the owner (reasons listed)
//   "block"  - a hard budget is exceeded: open the PR as review and say it must not be merged as is
// Usage: node tools/catalog-gate.mjs --base origin/main --measure measure.json --out report.json --summary summary.md
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function gitJson(ref, file) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
  } catch {
    return null;
  }
}

const rowKey = (row) => `${row.identifier}/${row.file ?? row.id ?? ''}`;

/** Pure. base/head are { extra, docs, audio } payloads (null = missing file). */
export function evaluate(base, head, measure, config, probe = null) {
  const rules = config.autoMerge;
  const review = [];
  const block = [];
  const baseExtra = new Map((base.extra?.channels ?? []).map((c) => [c.id, c]));
  const headExtra = new Map((head.extra?.channels ?? []).map((c) => [c.id, c]));

  const addedChannels = [...headExtra.values()].filter((c) => !baseExtra.has(c.id));
  const removedChannels = [...baseExtra.values()].filter((c) => !headExtra.has(c.id));
  const renamedChannels = [];
  const movedChannels = [];
  let addedRows = 0;
  let removedRows = 0;
  let modifiedRows = 0;
  const shrunkChannels = [];
  for (const [id, after] of headExtra) {
    const before = baseExtra.get(id);
    if (!before) { addedRows += after.rows?.length ?? 0; continue; }
    if (before.name !== after.name) renamedChannels.push({ id, from: before.name, to: after.name });
    if (before.guideId !== after.guideId || before.group !== after.group) {
      movedChannels.push({ id, from: `${before.guideId}/${before.group}`, to: `${after.guideId}/${after.group}` });
    }
    const beforeRows = new Map((before.rows ?? []).map((r) => [rowKey(r), r]));
    const afterRows = new Map((after.rows ?? []).map((r) => [rowKey(r), r]));
    let gone = 0;
    for (const key of beforeRows.keys()) if (!afterRows.has(key)) gone++;
    for (const [key, row] of afterRows) {
      if (!beforeRows.has(key)) addedRows++;
      else if (JSON.stringify(beforeRows.get(key)) !== JSON.stringify(row)) modifiedRows++;
    }
    if (gone) { removedRows += gone; shrunkChannels.push({ id, removedRows: gone }); }
  }
  for (const c of removedChannels) removedRows += c.rows?.length ?? 0;

  const docKey = (e) => `${e.id}|${e.u}`;
  const baseDocs = new Set((base.docs ?? []).map(docKey));
  const headDocs = new Set((head.docs ?? []).map(docKey));
  const addedDocs = [...headDocs].filter((k) => !baseDocs.has(k)).length;
  const removedDocs = [...baseDocs].filter((k) => !headDocs.has(k)).length;
  const baseDocByKey = new Map((base.docs ?? []).map((e) => [docKey(e), e]));
  let modifiedDocs = 0;
  let movedDocs = 0;
  for (const e of head.docs ?? []) {
    const before = baseDocByKey.get(docKey(e));
    if (!before) continue;
    if (before.g !== e.g) movedDocs++;
    else if (JSON.stringify(before) !== JSON.stringify(e)) modifiedDocs++;
  }
  const baseDocGroups = new Set((base.docs ?? []).map((e) => e.g));
  const newDocGroups = [...new Set((head.docs ?? []).map((e) => e.g))].filter((g) => !baseDocGroups.has(g));

  const baseAudio = new Map((base.audio ?? []).map((a) => [a.id, a]));
  const headAudio = new Map((head.audio ?? []).map((a) => [a.id, a]));
  const addedAudio = [...headAudio.keys()].filter((id) => !baseAudio.has(id));
  const removedAudio = [...baseAudio.keys()].filter((id) => !headAudio.has(id));
  const modifiedAudio = [...headAudio.entries()].filter(([id, a]) => baseAudio.has(id) && JSON.stringify(baseAudio.get(id)) !== JSON.stringify(a)).map(([id]) => id);

  const notDeferred = addedChannels.filter((c) => c.guideId === 'classic-tv' && c.deferLightRows !== true).map((c) => c.id);

  const changed = addedChannels.length || removedChannels.length || renamedChannels.length || movedChannels.length
    || addedRows || removedRows || addedDocs || removedDocs || addedAudio.length || removedAudio.length
    || modifiedRows || modifiedDocs || movedDocs || modifiedAudio.length;

  if (!rules.allowRemovals) {
    if (removedChannels.length) review.push(`${removedChannels.length} channel(s) removed: ${removedChannels.map((c) => c.id).slice(0, 10).join(', ')}`);
    if (removedRows) review.push(`${removedRows} episode/movie row(s) removed from existing channels`);
    if (removedDocs) review.push(`${removedDocs} documentary entr(ies) removed`);
    if (removedAudio.length) review.push(`${removedAudio.length} audio channel(s) removed`);
  }
  if (!rules.allowRenames && renamedChannels.length) review.push(`${renamedChannels.length} channel name(s) changed`);
  if (movedChannels.length) review.push(`${movedChannels.length} channel(s) moved to another guide/group`);
  if (movedDocs) review.push(`${movedDocs} documentary entr(ies) moved to another group`);
  if (modifiedAudio.length) review.push(`${modifiedAudio.length} existing audio channel(s) changed: ${modifiedAudio.slice(0, 10).join(', ')}`);
  const modified = modifiedRows + modifiedDocs;
  if (modified > rules.maxModifiedEntries) review.push(`${modified} existing rows/entries changed (title, duration, file details) > limit ${rules.maxModifiedEntries}`);
  if (addedChannels.length > rules.maxNewChannels) review.push(`${addedChannels.length} new channels > limit ${rules.maxNewChannels}`);
  if (addedRows > rules.maxNewRows) review.push(`${addedRows} new rows > limit ${rules.maxNewRows}`);
  if (addedDocs > rules.maxNewDocumentaryEntries) review.push(`${addedDocs} new documentary entries > limit ${rules.maxNewDocumentaryEntries}`);
  if (addedAudio.length > rules.maxNewAudioChannels) review.push(`${addedAudio.length} new audio channels > limit ${rules.maxNewAudioChannels}`);
  if (rules.requireDeferredClassicChannels && notDeferred.length) review.push(`new Classic TV channel(s) not lazy-loaded: ${notDeferred.join(', ')}`);

  if (changed) {
    if (!probe) review.push('playability probe did not run');
    else {
      if (probe.unprobed > 0) review.push(`${probe.unprobed} new row(s) not probed${probe.stoppedAt ? ` (Archive answered HTTP ${probe.stoppedAt.status})` : ''}`);
      const rate = probe.probed ? probe.failed.length / probe.probed : 0;
      if (rate > rules.maxProbeFailureRate) review.push(`${probe.failed.length}/${probe.probed} new rows failed the playability probe (removed); rate above ${rules.maxProbeFailureRate}`);
    }
  }
  const b = config.budgets;
  if (!measure) {
    block.push('payload measurement missing');
  } else {
    const check = (label, value, limits, unit) => {
      if (value > limits.hardLimit) block.push(`${label} ${value}${unit} exceeds hard limit ${limits.hardLimit}${unit}`);
      else if (value > limits.autoMergeMax) review.push(`${label} ${value}${unit} above auto-merge ceiling ${limits.autoMergeMax}${unit}`);
    };
    check('classic light schedule', measure.classicLightBytes, b.classicLightBytes, ' B');
    check('classic full schedule (raw)', measure.classicFullBytes, b.classicFullBytes, ' B');
    check('classic full schedule (gzip, as sent)', measure.classicFullGzipBytes, b.classicFullGzipBytes, ' B');
    for (const [guideId, limits] of Object.entries(b.guideMB)) {
      const value = measure.guideMB?.[guideId];
      if (typeof value !== 'number') block.push(`${guideId} payload not measured`);
      else check(`${guideId} payload`, value, limits, ' MB');
    }
  }

  const verdict = !changed ? 'none' : block.length ? 'block' : review.length ? 'review' : 'auto';
  return {
    verdict,
    reasons: [...block, ...review],
    counts: {
      addedChannels: addedChannels.length, removedChannels: removedChannels.length,
      renamedChannels: renamedChannels.length, movedChannels: movedChannels.length,
      addedRows, removedRows, addedDocs, removedDocs, newDocGroups: newDocGroups.length,
      addedAudio: addedAudio.length, removedAudio: removedAudio.length,
      modifiedRows, modifiedDocs, movedDocs, modifiedAudio: modifiedAudio.length,
    },
    addedChannels: addedChannels.map((c) => ({ id: c.id, guideId: c.guideId, group: c.group, name: c.name, rows: c.rows?.length ?? 0, deferLightRows: c.deferLightRows === true })),
    removedChannels: removedChannels.map((c) => ({ id: c.id, name: c.name, rows: c.rows?.length ?? 0 })),
    renamedChannels, movedChannels, shrunkChannels, newDocGroups, addedAudio, removedAudio,
    measure,
    probe: probe ? { targets: probe.targets, probed: probe.probed, ok: probe.ok, failed: probe.failed.length, unprobed: probe.unprobed, requests: probe.requests ?? null, droppedChannels: probe.droppedChannels ?? [] } : null,
    note: 'Station numbers are alphabetical positions (src/guide/channelIndex.ts numberChannels), so any added channel renumbers the channels after it. Not gated.',
  };
}

export function summaryMarkdown(report) {
  const c = report.counts;
  const lines = [
    `## Catalog refresh: **${report.verdict.toUpperCase()}**`,
    '',
    report.reasons.length ? 'Reasons:\n' + report.reasons.map((r) => `- ${r}`).join('\n') : 'All auto-merge rules satisfied.',
    '',
    '| | added | removed |', '|---|---|---|',
    `| channels | ${c.addedChannels} | ${c.removedChannels} |`,
    `| rows | ${c.addedRows} | ${c.removedRows} |`,
    `| documentary entries | ${c.addedDocs} | ${c.removedDocs} |`,
    `| audio channels | ${c.addedAudio} | ${c.removedAudio} |`,
    '',
    `Renamed: ${c.renamedChannels} · Moved: ${c.movedChannels} · New documentary groups: ${c.newDocGroups}`,
    `Changed in place: ${c.modifiedRows} rows · ${c.modifiedDocs} documentary entries · ${c.movedDocs} documentary entries moved · ${c.modifiedAudio} audio channels`,
  ];
  if (report.measure) {
    const m = report.measure;
    lines.push('', `Payloads: classic light ${m.classicLightBytes.toLocaleString('en-US')} B · classic full ${m.classicFullBytes.toLocaleString('en-US')} B raw / ${(m.classicFullGzipBytes ?? 0).toLocaleString('en-US')} B gzip · ` +
      Object.entries(m.guideMB).map(([g, v]) => `${g} ${v} MB`).join(' · '));
  }
  if (report.probe) {
    const p = report.probe;
    lines.push('', `Playability probe: ${p.ok}/${p.probed} new rows answered with media; ${p.failed} failed and were removed; ${p.unprobed} not probed.`);
  }
  if (report.addedChannels.length) {
    lines.push('', '<details><summary>New channels</summary>', '', ...report.addedChannels.map((ch) => `- \`${ch.id}\` ${ch.guideId}/${ch.group}: ${ch.name} (${ch.rows} rows${ch.deferLightRows ? ', lazy' : ''})`), '', '</details>');
  }
  if (report.removedChannels.length) {
    lines.push('', '<details><summary>Removed channels</summary>', '', ...report.removedChannels.map((ch) => `- \`${ch.id}\` ${ch.name} (${ch.rows} rows)`), '', '</details>');
  }
  if (report.renamedChannels.length) {
    lines.push('', '<details><summary>Renamed channels</summary>', '', ...report.renamedChannels.map((r) => `- \`${r.id}\`: ${r.from} → ${r.to}`), '', '</details>');
  }
  lines.push('', `_${report.note}_`);
  return lines.join('\n');
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const a = args(process.argv.slice(2));
  const config = readJson(a.config ?? 'config/catalog-refresh.json');
  const files = config.dataFiles;
  const base = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, gitJson(a.base ?? 'origin/main', f)]));
  const head = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readJson(f)]));
  const measure = a.measure ? readJson(a.measure) : null;
  const probe = a.probe ? readJson(a.probe) : null;
  const report = evaluate(base, head, measure, config, probe);
  if (a.out) writeFileSync(a.out, JSON.stringify(report, null, 1));
  if (a.summary) writeFileSync(a.summary, summaryMarkdown(report));
  console.log(summaryMarkdown(report));
}
