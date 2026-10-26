import fs from 'node:fs';
import path from 'node:path';
import { classifyShow } from './classify';

const root = path.resolve('tools/nker150');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'nker150_catalog.json'), 'utf8')) as {
  items: Array<{ identifier: string; title: string; originalCreator?: string | null; showId: string }>;
};
const classified = catalog.items.map((item) => ({
  identifier: item.identifier,
  storedShowId: item.showId,
  showId: classifyShow({
    identifier: item.identifier,
    title: item.title,
    creator: item.originalCreator ?? '',
  }).showId,
}));
const approved = classified.filter((item) => item.showId === 'alex-jones-show');
if (approved.length !== 90) {
  throw new Error(`Expected 90 Alex Jones Show archives; found ${approved.length}: ${approved.map((item) => item.identifier).join(', ')}`);
}
const mismatches = approved.filter((item) => item.storedShowId !== item.showId);
if (mismatches.length) {
  throw new Error(`Stored show classification disagrees with show-rules.json: ${mismatches.map((item) => item.identifier).join(', ')}`);
}

const approvals = approved.map(({ identifier }) => ({
  identifier,
  approvedBy: 'owner',
  approvedAt: '2026-10-26',
  scope: 'display+playback',
  note: 'Owner hand-approval: Alex Jones Show archives group',
}));
const destination = path.join(root, 'owner-approvals.json');
fs.writeFileSync(destination, `${JSON.stringify({ schemaVersion: 1, approvals }, null, 2)}\n`);
console.log(JSON.stringify({ approvalCount: approvals.length, showId: 'alex-jones-show', identifiers: approvals.map((item) => item.identifier) }));
