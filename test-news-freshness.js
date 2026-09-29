import { test } from 'node:test';
import assert from 'node:assert';
import { searchTVNews } from './channels.ts';

test('News API structural invariants', async () => {
    // 1. Fetch from live Archive.org via the exported function
    const result = await searchTVNews({ network: 'CNNW', rows: 12 });

    // 2. Assert ALWAYS invariants
    assert(Array.isArray(result.items), 'items must always be an array');
    assert.strictEqual(typeof result.total, 'number', 'total must always be a number');
    assert.strictEqual(typeof result.safeEndDate, 'string', 'safeEndDate must always be a string');

    // 3. Assert STATUS contract
    const validStatuses = ['ok', 'empty', 'upstream_error'];
    assert(
        validStatuses.includes(result.status), 
        `status must be one of: ${validStatuses.join(', ')}. Got: ${result.status}`
    );

    // 4. Assert STATE-SPECIFIC invariants
    if (result.status === 'ok') {
        assert(result.items.length > 0, 'status "ok" requires items.length > 0');
        assert(result.total > 0, 'status "ok" requires total > 0');
    } else if (result.status === 'empty') {
        assert.strictEqual(result.items.length, 0, 'status "empty" requires exactly 0 items');
        assert.strictEqual(result.total, 0, 'status "empty" requires total === 0');
    } else if (result.status === 'upstream_error') {
        assert.strictEqual(result.items.length, 0, 'status "upstream_error" requires exactly 0 items');
        assert.strictEqual(result.total, 0, 'status "upstream_error" requires total === 0');
        assert.strictEqual(typeof result.error, 'string', 'status "upstream_error" requires an error string');
    }
});
