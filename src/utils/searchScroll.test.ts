import assert from 'node:assert/strict';
import { searchScrollBehavior, shouldScrollResults } from './searchScroll';

assert.equal(shouldScrollResults(100, 844, 56), false, 'visible results do not scroll');
assert.equal(shouldScrollResults(40, 844, 56), true, 'results obscured by the sticky header scroll');
assert.equal(shouldScrollResults(900, 844, 56), true, 'results below the viewport scroll');
assert.equal(shouldScrollResults(Number.NaN, 844, 56), false, 'invalid geometry does not trigger scrolling');
assert.equal(searchScrollBehavior(true), 'auto', 'reduced motion uses immediate scrolling');
assert.equal(searchScrollBehavior(false), 'smooth', 'normal motion uses smooth scrolling');

console.log('PASS searchScroll: visibility guard and reduced-motion behavior');
