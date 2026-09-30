import assert from "node:assert/strict";
import {
  createPlayer,
  loadRumbleLoader,
  RUMBLE_EMBED_LOADER_URL,
  RUMBLE_EMBED_PLAYER_LIMIT,
  RUMBLE_EMBED_TIMEOUT_MS,
  RUMBLE_OFFICIAL_LOADER_STUB,
} from "./embedAdapter";

type FakeContainer = HTMLElement;
const scripts: Array<{ textContent: string | null }> = [];
const calls: Array<{ command: string; args: { video: string; div: string } }> = [];

class FakeMutationObserver {
  constructor(_callback: () => void) {}
  observe() {}
  disconnect() {}
}

(globalThis as { MutationObserver?: unknown }).MutationObserver = FakeMutationObserver;
(globalThis as { document?: unknown }).document = {
  createElement(tag: string) {
    if (tag !== "script") throw new Error("unexpected element " + tag);
    return { textContent: null as string | null };
  },
  head: {
    appendChild(script: { textContent: string | null }) {
      scripts.push(script);
      (globalThis as { Rumble?: unknown }).Rumble = (command: string, args: { video: string; div: string }) => {
        calls.push({ command, args });
      };
    },
  },
};

assert.equal(RUMBLE_EMBED_LOADER_URL, "https://rumble.com/embedJS/u4");
assert.equal(RUMBLE_EMBED_PLAYER_LIMIT, 4);
assert.equal(RUMBLE_EMBED_TIMEOUT_MS, 10_000);
assert.equal(
  RUMBLE_OFFICIAL_LOADER_STUB,
  '<script>!function(r,u,m,b,l,e){r._Rumble=b,r[b]||(r[b]=function(){(r[b]._=r[b]._||[]).push(arguments);if(r[b]._.length==1){l=u.createElement(m),e=u.getElementsByTagName(m)[0],l.async=1,l.src="https://rumble.com/embedJS/u4"+(arguments[1].video?\'.\'+arguments[1].video:"")+"/?url="+encodeURIComponent(location.href)+"&args="+encodeURIComponent(JSON.stringify([].slice.apply(arguments))),e.parentNode.insertBefore(l,e)}})}(window, document, "script", "Rumble");</script>',
);

await loadRumbleLoader();
await loadRumbleLoader();
assert.equal(scripts.length, 1);
assert.equal(scripts[0]?.textContent, RUMBLE_OFFICIAL_LOADER_STUB.slice(8, -9));

const makeContainer = (id: string) => ({
  id,
  replaceChildren() {},
  querySelector() { return null; },
}) as unknown as FakeContainer;

const timeouts: string[] = [];
const originalSetTimeout = globalThis.setTimeout;
(globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((cb: TimerHandler) => {
  if (typeof cb === "function") cb();
  return 1 as unknown as ReturnType<typeof setTimeout>;
}) as typeof setTimeout;
const timeoutCleanup = createPlayer(makeContainer("timeout"), "v-timeout", { onTimeout: () => timeouts.push("timeout") });
assert.deepEqual(timeouts, ["timeout"]);
timeoutCleanup();
(globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;

const containers = [1, 2, 3, 4].map((n) => makeContainer("p" + n));
const cleanups = containers.map((container, index) => createPlayer(container, "v" + (index + 1)));
await Promise.resolve();
assert.equal(calls.length, 4);
assert.deepEqual(calls.at(-1), { command: "play", args: { video: "v4", div: "rumble_v4" } });
assert.throws(() => createPlayer(containers[0], "again"), /one-player-per-container/);
assert.throws(() => createPlayer(makeContainer("p5"), "v5"), /maximum-four-players/);
cleanups.forEach((cleanup) => cleanup());

console.log("[rumble-embed] PASS: exact official loader stub, official play call, timeout, one-player-per-container, and four-player cap.");
