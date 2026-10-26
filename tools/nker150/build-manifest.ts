import fs from 'node:fs';
import path from 'node:path';
import { classifyShow } from './classify';
import { parseCsv, writeCsv } from './csv';
import { classifyNker150Rights } from '../../server/nker150Rights';

const root = path.resolve('tools/nker150');
const sourceItems = parseCsv(fs.readFileSync(path.join(root, 'input/items.csv'), 'utf8'));
const selectedFiles = parseCsv(fs.readFileSync(path.join(root, 'input/selected-files.csv'), 'utf8'));
const evidencePath = path.join(root, 'playback-evidence.json');
const evidence = fs.existsSync(evidencePath)
  ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as { items?: Array<{ identifier: string; status: string }> }
  : { items: [] };
const verified = new Set((evidence.items ?? []).filter((item) => item.status === 'VERIFIED').map((item) => item.identifier));
const fileById = new Map<string, Record<string, string>>();
for (const file of selectedFiles) {
  if (file.selected !== 'true' || file.private === 'true' || fileById.has(file.identifier)) continue;
  fileById.set(file.identifier, file);
}

const catalog = sourceItems.map((item) => {
  const file = fileById.get(item.identifier);
  const classification = classifyShow({
    identifier: item.identifier,
    title: item.title,
    creator: item.creator,
  });
  let status: string = 'NOT_TESTED';
  let reason = 'no browser playback evidence';
  if (verified.has(item.identifier)) {
    status = 'VERIFIED';
    reason = 'real-browser playback evidence recorded';
  } else if (item.status === 'RESTRICTED' || file?.private === 'true') {
    status = 'RESTRICTED';
    reason = 'cached metadata marked the item or file restricted';
  } else if (item.status === 'NO_SUPPORTED_VIDEO' || !file) {
    status = 'PENDING_REVIEW';
    reason = 'no selected supported public video file in the cached metadata';
  }
  const licenseUrl = item.licenseurl || null;
  const rightsReview = classifyNker150Rights(licenseUrl);
  const itemSizeBytes = item.item_size && /^\d+$/.test(item.item_size) ? Number(item.item_size) : null;
  return {
    id: `ia-${item.identifier}`,
    identifier: item.identifier,
    title: item.title || item.identifier,
    originalCreator: item.creator && !/@[^\s]+\.[^\s]+/.test(item.creator) ? item.creator : null,
    date: item.date || null,
    itemSizeBytes,
    licenseUrl,
    rightsStatus: licenseUrl ? 'LISTED' : 'UNKNOWN',
    rightsReview,
    archiveDetailsUrl: `https://archive.org/details/${encodeURIComponent(item.identifier)}`,
    showId: classification.showId,
    showLabel: classification.showLabel,
    unclassified: classification.unclassified,
    technicalStatus: status,
    reason,
    file: file ? {
      filename: file.filename,
      path: `/download/${encodeURIComponent(item.identifier)}/${encodeURIComponent(file.filename)}`,
      format: file.format || null,
      fileSizeBytes: /^\d+$/.test(file.size ?? '') ? Number(file.size) : null,
      durationSeconds: /^\d+(\.\d+)?$/.test(file.length ?? '') ? Number(file.length) : null,
      isPrivate: file.private === 'true',
    } : null,
  };
});

const allowed = new Set(['VERIFIED', 'NOT_TESTED', 'INCONCLUSIVE', 'FAILED', 'RESTRICTED', 'PENDING_REVIEW']);
if (catalog.some((item) => !allowed.has(item.technicalStatus))) throw new Error('catalog contains an unsupported technical status');
const rightsCounts = catalog.reduce((counts, item) => {
  counts[item.rightsStatus] += 1;
  return counts;
}, { LISTED: 0, UNKNOWN: 0 });
const rightsReviewCounts = catalog.reduce((counts, item) => {
  counts[item.rightsReview] += 1;
  return counts;
}, { ALLOWLIST_PATTERN: 0, PENDING_REVIEW: 0 });
if (rightsCounts.LISTED !== 273 || rightsCounts.UNKNOWN !== 111) {
  throw new Error(`cached rights mapping changed unexpectedly: ${JSON.stringify(rightsCounts)}`);
}
const unclassified = catalog.filter((item) => item.unclassified).map((item) => [item.identifier, 'fallback_documentaries']);
const manifestItems = catalog.filter((item) => item.technicalStatus === 'VERIFIED' && item.file).map((item) => ({
  id: item.id,
  identifier: item.identifier,
  title: item.title,
  description: 'Internet Archive source item; playback status verified in the AJN player.',
  categoryIds: ['nker150-special'],
  mediaType: 'video',
  year: /^\d{4}/.test(item.date ?? '') ? Number(item.date!.slice(0, 4)) : undefined,
  decade: /^\d{4}/.test(item.date ?? '') ? Math.floor(Number(item.date!.slice(0, 4)) / 10) * 10 : undefined,
  path: item.file!.path,
  file: item.file!.filename,
  format: item.file!.format ?? 'unknown',
  dur: Math.round(item.file!.durationSeconds ?? 0),
  durSrc: 'metadata',
  durEst: item.file!.durationSeconds === null,
  availability: 'verified',
  foundBy: 'nker150 cached metadata',
  why: 'real-browser playback verified',
  indexedAt: evidence.items?.find((entry) => entry.identifier === item.identifier)?.status === 'VERIFIED'
    ? '2026-10-25'
    : undefined,
  originalCreator: item.originalCreator,
  itemSizeBytes: item.itemSizeBytes,
  fileSizeBytes: item.file!.fileSizeBytes,
  licenseUrl: item.licenseUrl,
  rightsStatus: item.rightsStatus,
  rightsReview: item.rightsReview,
  archiveDetailsUrl: item.archiveDetailsUrl,
  showId: item.showId,
  showLabel: item.showLabel,
  technicalStatus: 'PLAYABLE_VERIFIED',
}));

fs.writeFileSync(path.join(root, 'nker150_catalog.json'), `${JSON.stringify({ schemaVersion: 1, generatedFrom: 'cached 2026-10-25 metadata CSV; no refetch', items: catalog }, null, 2)}\n`);
writeCsv(path.join(root, 'unclassified.csv'), ['identifier', 'reason'], unclassified);
fs.writeFileSync(path.resolve('src/data/nker150Manifest.json'), `${JSON.stringify({ schemaVersion: 1, items: manifestItems }, null, 2)}\n`);
console.log(JSON.stringify({
  catalogItems: catalog.length,
  manifestItems: manifestItems.length,
  rightsCounts,
  rightsReviewCounts,
  itemSizePresent: catalog.filter((item) => item.itemSizeBytes !== null).length,
  itemSizeNull: catalog.filter((item) => item.itemSizeBytes === null).length,
  unclassified: unclassified.length,
}));
