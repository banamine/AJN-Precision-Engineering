import assert from 'node:assert/strict';
import { compileNetwork, HOUR, publicationHash } from './server/classicNetwork';
import { createPublicationReader, validatePublication } from './server/classicNetworkPublication';
import { fixtureSettings, fixtureNetwork, fixtureCatalog } from './test-classic-network-compiler';
const p = compileNetwork(fixtureSettings, fixtureNetwork, fixtureCatalog);
assert.equal(validatePublication(p).revision, p.revision);
assert(createPublicationReader(null).getWindow(Date.now()).error);
assert(createPublicationReader({ ...p, revision: 'bad' }).getWindow(Date.now()).error);
for (const delta of [-1, 1]) {
  const broken = structuredClone(p);
  broken.programs[1].startTimeUtc = new Date(Date.parse(broken.programs[1].startTimeUtc!) + delta).toISOString();
  broken.revision = publicationHash(broken);
  assert(createPublicationReader(broken).getWindow(Date.now()).error);
}
const reader = createPublicationReader(p);
assert(reader.getWindow(p.coveredUntilUtcMs).error?.includes('Schedule ends'));
assert(reader.getWindow(Date.parse(p.activeFrom) - 1).error?.includes('Schedule starts'));
const now = Date.parse(p.activeFrom) + HOUR / 2;
const window = reader.getWindow(now);
assert.equal(window.programs.filter(v => Date.parse(v.startTimeUtc!) < now).length, 1);
assert(window.programs.every(v => Date.parse(v.startTimeUtc!) < now + 48 * HOUR));
const renewed = compileNetwork({ ...fixtureSettings, activeFrom: '2026-10-30T00:00:00 America/Los_Angeles', horizonDays: 6 }, fixtureNetwork, fixtureCatalog, p);
assert(createPublicationReader(renewed).getWindow(now).programs.length > 0, 'A future revision must keep serving its approved earlier prefix');
console.log('CLASSIC_NETWORK_PUBLICATION_PASS assertions=10');
