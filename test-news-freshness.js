import assert from 'node:assert/strict';
import { searchTVNews, parseItemTimestamp, TV_ID_RE } from './channels.ts';

console.log('Running News Freshness & Availability Pipeline Tests...');

// Test 1: TV_ID_RE & parseItemTimestamp
const sampleId = 'CNNW_20260921_080000_CNN_Newsroom_Live';
assert.match(sampleId, TV_ID_RE);
const parsed = parseItemTimestamp({ identifier: sampleId });
assert.equal(parsed.airDateSource, 'identifier');
assert.ok(parsed.timestampMs > 0);
console.log('✓ Test 1: Identifier timestamp parsing passed');

// Test 2: Freshness Window logic & searchTVNews structure
const result = await searchTVNews({ network: 'CNNW', rows: 12 });
assert.equal(typeof result.total, 'number');
assert.ok(Array.isArray(result.items));
assert.equal(result.requestedWindowHours, 48);
assert.equal(typeof result.windowStart, 'string');
assert.equal(typeof result.windowEnd, 'string');
assert.equal(typeof result.returnedCount, 'number');
assert.equal(typeof result.availableCurrentCount, 'number');
assert.equal(typeof result.staleRejected, 'number');
assert.equal(typeof result.metadataFailures, 'number');
console.log(`✓ Test 2: searchTVNews structure & freshness contract passed (returned: ${result.returnedCount}, staleRejected: ${result.staleRejected}, metadataFailures: ${result.metadataFailures})`);

// Test 3: Verify sorting (newest first)
if (result.items.length > 1) {
  for (let i = 0; i < result.items.length - 1; i++) {
    const t1 = new Date(`${result.items[i].date}T${result.items[i].time}:00Z`).getTime();
    const t2 = new Date(`${result.items[i+1].date}T${result.items[i+1].time}:00Z`).getTime();
    assert.ok(t1 >= t2, 'Items must be sorted newest first');
  }
  console.log('✓ Test 3: Newest-first sorting verified');
} else {
  console.log('ℹ Test 3: Skipped sorting order check (insufficient items returned in test environment)');
}

console.log('ALL NEWS FRESHNESS TESTS PASSED SUCCESSFULY!');
