import assert from 'node:assert/strict';
import { proxySliceRange, PROXY_SLICE_BYTES as S } from './server/proxyRange.ts';
assert.deepEqual(proxySliceRange('bytes=0-'), { start: 0, end: S - 1 });
assert.deepEqual(proxySliceRange(undefined), { start: 0, end: S - 1 });
assert.deepEqual(proxySliceRange('bytes=0-1023'), { start: 0, end: 1023 });
assert.deepEqual(proxySliceRange('bytes=100000000-'), { start: 100000000, end: 100000000 + S - 1 });
assert.deepEqual(proxySliceRange('bytes=5-999999999'), { start: 5, end: 5 + S - 1 });
console.log('proxy range slicing: all passed');
