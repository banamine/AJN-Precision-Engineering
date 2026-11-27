import assert from 'node:assert/strict';
import { RULES_KEY, SEEN_KEY, MAX_SEEN, canAddRule, loadRules, loadSeen, newRuleId, ruleFromDraft, saveRules, saveSeen } from './alertRules.ts';

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const st = mem();
const rule = ruleFromDraft({ name: 'Competitors', showIds: null, terms: [{ type: 'competitor', text: 'Acme', aliases: 'Acme Corp, ACME inc, ' }, { type: 'keyword', text: ' ', aliases: '' }] }, 'r-test')!;
assert.ok(rule); assert.equal(rule.id, 'r-test'); assert.deepEqual(rule.scope, { kind: 'all' });
assert.equal(rule.terms.length, 1, 'the blank term row is dropped'); assert.deepEqual(rule.terms[0].aliases, ['Acme Corp', 'ACME inc']);
assert.equal(ruleFromDraft({ name: '', showIds: null, terms: [{ type: 'keyword', text: 'abc', aliases: '' }] }), null, 'needs a name');
assert.equal(ruleFromDraft({ name: 'x', showIds: null, terms: [{ type: 'keyword', text: 'a', aliases: '' }] }), null, 'needs a 2+ letter term');
assert.deepEqual(ruleFromDraft({ name: 'x', showIds: ['s1'], terms: [{ type: 'brand', text: 'abc', aliases: '' }] })!.scope, { kind: 'shows', showIds: ['s1'] });

assert.equal(saveRules([rule], st), true);
assert.deepEqual(loadRules(st), [rule], 'round trip');
st.m.set(RULES_KEY, '{not json'); assert.deepEqual(loadRules(st), [], 'corrupt storage reads as empty');
assert.deepEqual(loadRules(null), []);
const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
assert.equal(saveRules([rule], full), false, 'a failed save says so'); assert.equal(saveRules([rule], null), false);

assert.deepEqual([...loadSeen(st)], []);
assert.equal(saveSeen(['a', 'b'], st), true); assert.deepEqual([...loadSeen(st)], ['a', 'b']);
saveSeen(Array.from({ length: MAX_SEEN + 50 }, (_, i) => `h${i}`), st);
const seen = loadSeen(st); assert.equal(seen.size, MAX_SEEN); assert.ok(seen.has(`h${MAX_SEEN + 49}`) && !seen.has('h0'), 'keeps the newest');
st.m.set(SEEN_KEY, '"oops"'); assert.equal(loadSeen(st).size, 0);
assert.equal(canAddRule(Array.from({ length: 20 }, () => rule)), false); assert.equal(canAddRule([rule]), true);
assert.notEqual(newRuleId(1, () => 0.1), newRuleId(2, () => 0.1));
console.log('alertRules tests passed');
