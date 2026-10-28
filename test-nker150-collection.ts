import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyNker150Rights, shouldExposeNker150Record } from './server/nker150Rights';
import { classifyShow } from './tools/nker150/classify';

const catalog = JSON.parse(fs.readFileSync('tools/nker150/nker150_catalog.json', 'utf8')) as {
  items: Array<{
    technicalStatus: string; identifier: string; title: string; originalCreator?: string | null;
    showId: string; rightsStatus: string; rightsReview: string; licenseUrl: string | null;
    itemSizeBytes: number | null; archiveDetailsUrl: string; file: { isPrivate: boolean } | null;
  }>;
};
const manifest = JSON.parse(fs.readFileSync('src/data/nker150Manifest.json', 'utf8')) as {
  items: Array<{ technicalStatus: string; identifier: string; rightsStatus: string; rightsReview: string; archiveDetailsUrl: string }>;
};
const ownerApprovalFile = JSON.parse(fs.readFileSync('tools/nker150/owner-approvals.json', 'utf8')) as {
  schemaVersion: number;
  approvals: Array<{ identifier: string; approvedBy: string; approvedAt: string; scope: string; note: string }>;
};
const validStatuses = new Set(['VERIFIED', 'PROXY_VERIFIED', 'NOT_TESTED', 'INCONCLUSIVE', 'FAILED', 'RESTRICTED', 'PENDING_REVIEW']);
assert.equal(catalog.items.length, 384, 'the cached source has 384 items; no refetch is allowed');
assert.ok(catalog.items.every((item) => validStatuses.has(item.technicalStatus)), 'every item must carry an explicit allowed status');
assert.ok(catalog.items.every((item) => ['LISTED', 'UNKNOWN'].includes(item.rightsStatus)), 'rights metadata remains separate');
assert.ok(catalog.items.every((item) => item.archiveDetailsUrl.startsWith('https://archive.org/details/')));
assert.ok(catalog.items.every((item) => item.itemSizeBytes === null || item.itemSizeBytes > 0));
assert.equal(catalog.items.filter((item) => item.rightsStatus === 'LISTED').length, 273);
assert.equal(catalog.items.filter((item) => item.rightsStatus === 'UNKNOWN').length, 111);
assert.ok(catalog.items.some((item) => item.itemSizeBytes === null), 'missing item_size stays null, never zero');
assert.equal(ownerApprovalFile.schemaVersion, 1);
assert.equal(ownerApprovalFile.approvals.length, 90, 'exactly 90 Alex Jones Show archives are owner-approved');
const classifiedIds = catalog.items
  .filter((item) => classifyShow({ identifier: item.identifier, title: item.title, creator: item.originalCreator ?? '' }).showId === 'alex-jones-show')
  .map((item) => item.identifier);
assert.equal(catalog.items.filter((item) => item.showId === 'alex-jones-show').length, 90);
assert.deepEqual(ownerApprovalFile.approvals.map((item) => item.identifier), classifiedIds);
assert.ok(ownerApprovalFile.approvals.every((item) =>
  item.approvedBy === 'owner' && item.approvedAt === '2026-10-26' &&
  item.scope === 'display+playback' &&
  item.note === 'Owner hand-approval: Alex Jones Show archives group',
));
assert.ok(catalog.items.filter((item) => classifiedIds.includes(item.identifier)).every((item) => item.rightsReview === 'OWNER_APPROVED'));
const expectedManifestItems = catalog.items.filter((item) => shouldExposeNker150Record({
  technicalStatus: item.technicalStatus === 'VERIFIED' ? 'PLAYABLE_VERIFIED' : item.technicalStatus,
  rightsReview: classifyNker150Rights(item.licenseUrl, item.identifier),
  isPrivate: item.file?.isPrivate,
}));
assert.equal(manifest.items.length, expectedManifestItems.length, 'manifest matches normal-mode exposure rules');
assert.ok(manifest.items.every((item) => ['PLAYABLE_VERIFIED', 'PROXY_VERIFIED'].includes(item.technicalStatus)));
assert.ok(manifest.items.every((item) => expectedManifestItems.some((entry) => entry.identifier === item.identifier)));
assert.equal(classifyNker150Rights('https://creativecommons.org/licenses/by-sa/4.0/'), 'ALLOWLIST_PATTERN');
assert.equal(classifyNker150Rights('https://creativecommons.org/licenses/by-nc-sa/4.0/'), 'PENDING_REVIEW');
assert.equal(classifyNker150Rights(null), 'PENDING_REVIEW');
const testedItem = catalog.items.find((item) => item.technicalStatus === 'VERIFIED');
assert.ok(testedItem);
assert.equal(testedItem.identifier, '01_20200728_20200728_1511');
assert.equal(testedItem.rightsStatus, 'LISTED', 'listed license metadata is preserved');
assert.equal(testedItem.rightsReview, 'OWNER_APPROVED');
assert.ok(manifest.items.some((item) => item.identifier === testedItem.identifier && item.technicalStatus === 'PLAYABLE_VERIFIED'));
assert.equal(shouldExposeNker150Record({ technicalStatus: 'PLAYABLE_VERIFIED', rightsReview: 'PENDING_REVIEW' }), false);
assert.equal(shouldExposeNker150Record({ technicalStatus: 'PLAYABLE_VERIFIED', rightsReview: 'PENDING_REVIEW' }, true), true);
assert.equal(shouldExposeNker150Record({ technicalStatus: 'PLAYABLE_VERIFIED', rightsReview: 'ALLOWLIST_PATTERN' }), true);
assert.equal(shouldExposeNker150Record({ technicalStatus: 'PROXY_VERIFIED', rightsReview: 'OWNER_APPROVED' }), true);
assert.equal(shouldExposeNker150Record({ technicalStatus: 'FAILED', rightsReview: 'OWNER_APPROVED' }), false);
assert.equal(shouldExposeNker150Record({ technicalStatus: 'RESTRICTED', rightsReview: 'OWNER_APPROVED' }), false);
assert.equal(shouldExposeNker150Record({ technicalStatus: 'RESTRICTED', rightsReview: 'OWNER_APPROVED' }, true), false);
assert.equal(shouldExposeNker150Record({ technicalStatus: 'PLAYABLE_VERIFIED', rightsReview: 'OWNER_APPROVED', isPrivate: true }), false);
console.log(`PASS nker150 collection: ${catalog.items.length} catalog items; ${ownerApprovalFile.approvals.length} owner approvals; ${manifest.items.length} normal-mode exposed items`);
