import assert from 'node:assert/strict';
import { getNovaCanonicalPrograms } from './src/services/producers/novaProducer.ts';
import { getCanonicalPrograms } from './guideRegistry.ts';
import { getCuratedLibraryProjection, CURATED_CHANNEL_WHITELIST } from './src/services/libraryService.ts';

const nova = getNovaCanonicalPrograms();

assert.equal(nova.length, 6, 'Nova producer must emit exactly 6 verified episodes');
assert.ok(nova.every((program) => program.channelId === 'nova-wonders'));
assert.ok(nova.every((program) => program.guideId === 'science-documentaries'));
assert.ok(nova.every((program) => program.sourceClass === 'archive_org'));
assert.ok(nova.every((program) => program.sourceId?.trim()));
assert.ok(nova.every((program) => program.assetId?.trim()));
assert.equal(new Set(nova.map((program) => program.programId ?? program.id)).size, 6, 'Nova programs must be unique');
assert.equal(new Set(nova.map((program) => program.assetId)).size, 6, 'Nova assets must be unique');
assert.ok(nova.every((program) => program.mediaUrl.startsWith('/download/nova-wonders/')));
assert.ok(nova.every((program) => program.mediaUrl.endsWith('.mp4')));
assert.ok(nova.every((program) => !program.mediaUrl.includes('BigBuckBunny')));

const canonicalNova = getCanonicalPrograms().filter((program) => program.channelId === 'nova-wonders');
assert.equal(canonicalNova.length, 6, 'Registry must hydrate all 6 Nova programs');
assert.ok(CURATED_CHANNEL_WHITELIST.has('nova-wonders'));

const libraryNova = getCuratedLibraryProjection().filter((item) => item.channelId === 'nova-wonders');
assert.equal(libraryNova.length, 6, 'Library must project all 6 verified Nova programs');
assert.ok(libraryNova.every((item) => item.sourceClass === 'archive_org'));
assert.ok(libraryNova.every((item) => item.sourceId && item.assetId && item.programId));

console.log('✅ Nova canonical producer verification: PASS (6 episodes)');
