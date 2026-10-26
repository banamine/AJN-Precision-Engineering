import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyNker150Rights, shouldExposeNker150Record } from './server/nker150Rights';

const catalog = JSON.parse(fs.readFileSync('tools/nker150/nker150_catalog.json', 'utf8')) as {
  items: Array<{ technicalStatus: string; identifier: string; rightsStatus: string; rightsReview: string; itemSizeBytes: number | null; archiveDetailsUrl: string }>;
};
const manifest = JSON.parse(fs.readFileSync('src/data/nker150Manifest.json', 'utf8')) as {
  items: Array<{ technicalStatus: string; identifier: string; rightsStatus: string; rightsReview: string; archiveDetailsUrl: string }>;
};
const validStatuses = new Set(['VERIFIED', 'NOT_TESTED', 'INCONCLUSIVE', 'FAILED', 'RESTRICTED', 'PENDING_REVIEW']);
assert.equal(catalog.items.length, 384, 'the cached source has 384 items; no refetch is allowed');
assert.ok(catalog.items.every((item) => validStatuses.has(item.technicalStatus)), 'every item must carry an explicit allowed status');
assert.ok(catalog.items.every((item) => ['LISTED', 'UNKNOWN'].includes(item.rightsStatus)), 'rights metadata remains separate');
assert.ok(catalog.items.every((item) => item.archiveDetailsUrl.startsWith('https://archive.org/details/')));
assert.ok(catalog.items.every((item) => item.itemSizeBytes === null || item.itemSizeBytes > 0));
assert.equal(catalog.items.filter((item) => item.rightsStatus === 'LISTED').length, 273);
assert.equal(catalog.items.filter((item) => item.rightsStatus === 'UNKNOWN').length, 111);
assert.ok(catalog.items.some((item) => item.itemSizeBytes === null), 'missing item_size stays null, never zero');
assert.ok(manifest.items.length >= 1, 'at least one item must be verified through browser playback');
assert.ok(manifest.items.every((item) => item.technicalStatus === 'PLAYABLE_VERIFIED'));
assert.ok(manifest.items.every((item) => catalog.items.some((entry) => entry.technicalStatus === 'VERIFIED' && entry.archiveDetailsUrl === item.archiveDetailsUrl)));
assert.equal(classifyNker150Rights('https://creativecommons.org/licenses/by-sa/4.0/'), 'ALLOWLIST_PATTERN');
assert.equal(classifyNker150Rights('https://creativecommons.org/licenses/by-nc-sa/4.0/'), 'PENDING_REVIEW');
assert.equal(classifyNker150Rights(null), 'PENDING_REVIEW');
const testedItem = catalog.items.find((item) => item.technicalStatus === 'VERIFIED');
assert.ok(testedItem);
assert.equal(testedItem.identifier, '01_20200728_20200728_1511');
assert.equal(testedItem.rightsStatus, 'LISTED', 'listed license is not treated as permission');
assert.equal(testedItem.rightsReview, 'PENDING_REVIEW', 'NC license stays held for owner review');
assert.ok(manifest.items.every((item) => item.rightsReview === 'PENDING_REVIEW' || item.rightsReview === 'ALLOWLIST_PATTERN'));
assert.equal(shouldExposeNker150Record({ technicalStatus: 'PLAYABLE_VERIFIED', rightsReview: 'PENDING_REVIEW' }), false);
assert.equal(shouldExposeNker150Record({ technicalStatus: 'PLAYABLE_VERIFIED', rightsReview: 'PENDING_REVIEW' }, true), true);
assert.equal(shouldExposeNker150Record({ technicalStatus: 'PLAYABLE_VERIFIED', rightsReview: 'ALLOWLIST_PATTERN' }), true);
console.log(`PASS nker150 collection: ${catalog.items.length} catalog items; ${manifest.items.length} browser-verified manifest items; 0 Archive requests`);
