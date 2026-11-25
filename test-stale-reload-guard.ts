import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Runs the real inline guard from index.html in a fake browser and checks the single-reload contract.
const html = fs.readFileSync('index.html', 'utf-8');
const m = html.match(/<script>\s*\/\* Stale-bundle recovery[\s\S]*?<\/script>/);
assert.ok(m, 'index.html carries the stale-bundle guard before the module script');
assert.ok(html.indexOf(m[0]) < html.indexOf('type="module"'), 'guard comes before the module script');
const code = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');

function browser(storageThrows = false) {
  let now = 1_000_000;
  const store = new Map<string, string>();
  const listeners: Array<(e: unknown) => void> = [];
  let reloads = 0;
  const win: Record<string, unknown> = {
    addEventListener: (_t: string, fn: (e: unknown) => void) => listeners.push(fn),
    location: { reload: () => { reloads++; } },
    sessionStorage: {
      getItem: (k: string) => { if (storageThrows) throw new Error('blocked'); return store.get(k) ?? null; },
      setItem: (k: string, v: string) => { if (storageThrows) throw new Error('blocked'); store.set(k, v); },
    },
  };
  const ctx = vm.createContext({ window: win, sessionStorage: win.sessionStorage, location: win.location, Date: { now: () => now }, Number, String });
  vm.runInContext(code, ctx);
  return { win, listeners, reloads: () => reloads, advance: (ms: number) => { now += ms; } };
}
const try_ = (b: ReturnType<typeof browser>) => (b.win.ajnTryStaleReload as () => boolean)();

let b = browser();
assert.equal(try_(b), true, 'first failure reloads');
assert.equal(try_(b), false, 'second failure within 30 s does not reload');
assert.equal(b.reloads(), 1);
b.advance(31_000);
assert.equal(try_(b), true, 'after the cooldown a new deploy can recover again');
assert.equal(b.reloads(), 2);

b = browser();
b.listeners[0]({ target: { tagName: 'SCRIPT', src: 'https://x.test/assets/index-old.js' } });
assert.equal(b.reloads(), 1, 'failed hashed entry script triggers a reload');
b.listeners[0]({ target: { tagName: 'IMG', src: 'https://x.test/assets/logo.png' } });
b.listeners[0]({ target: { tagName: 'SCRIPT', src: 'https://cdn.test/other.js' } });
assert.equal(b.reloads(), 1, 'unrelated failures never reload');

b = browser(true);
assert.equal(try_(b), false, 'if storage is blocked we never reload (no loop risk)');
assert.equal(b.reloads(), 0);
console.log('test-stale-reload-guard: ok');
