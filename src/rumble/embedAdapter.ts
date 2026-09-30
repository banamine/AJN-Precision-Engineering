const RUMBLE_LOADER_URL = "https://rumble.com/embedJS/u4";
const MAX_PLAYERS = 4;
const PLAYER_TIMEOUT_MS = 10_000;

export type RumbleEmbedCallbacks = {
  onCreated?: () => void;
  onLoad?: () => void;
  onError?: (error: unknown) => void;
  onTimeout?: () => void;
};

type RumbleGlobal = (command: string, args: { video: string; div: string }) => void;

const OFFICIAL_LOADER_STUB =
  '<script>!function(r,u,m,b,l,e){r._Rumble=b,r[b]||(r[b]=function(){(r[b]._=r[b]._||[]).push(arguments);if(r[b]._.length==1){l=u.createElement(m),e=u.getElementsByTagName(m)[0],l.async=1,l.src="https://rumble.com/embedJS/u4"+(arguments[1].video?\'.\'+arguments[1].video:"")+"/?url="+encodeURIComponent(location.href)+"&args="+encodeURIComponent(JSON.stringify([].slice.apply(arguments))),e.parentNode.insertBefore(l,e)}})}(window, document, "script", "Rumble");</script>';

let loaderPromise: Promise<void> | null = null;
const activeContainers = new Map<HTMLElement, () => void>();

function getRumble(): RumbleGlobal {
  const rumble = (globalThis as { Rumble?: RumbleGlobal }).Rumble;
  if (typeof rumble !== "function") throw new Error("Rumble loader did not expose Rumble");
  return rumble;
}

export function loadRumbleLoader(): Promise<void> {
  if (loaderPromise) return loaderPromise;
  if (typeof document === "undefined") return Promise.reject(new Error("Rumble loader requires a browser document"));
  loaderPromise = new Promise<void>((resolve, reject) => {
    try {
      const script = document.createElement("script");
      script.textContent = OFFICIAL_LOADER_STUB.slice(8, -9);
      document.head.appendChild(script);
      resolve();
    } catch (error) {
      loaderPromise = null;
      reject(error);
    }
  });
  return loaderPromise;
}

export function createPlayer(container: HTMLElement, embedId: string, callbacks: RumbleEmbedCallbacks = {}): () => void {
  if (activeContainers.has(container)) throw new Error("one-player-per-container");
  if (activeContainers.size >= MAX_PLAYERS) throw new Error("maximum-four-players");
  if (!embedId) throw new Error("embedId is required");

  container.replaceChildren();
  container.id = "rumble_" + embedId;
  let timeoutId: ReturnType<typeof setTimeout>;
  const observer = new MutationObserver(() => {
    const iframe = container.querySelector("iframe");
    if (!iframe || iframe.dataset.rumbleObserved === "true") return;
    iframe.dataset.rumbleObserved = "true";
    iframe.addEventListener("load", () => {
      clearTimeout(timeoutId);
      callbacks.onLoad?.();
    }, { once: true });
    iframe.addEventListener("error", (event) => {
      clearTimeout(timeoutId);
      callbacks.onError?.(event);
    }, { once: true });
  });
  observer.observe(container, { childList: true, subtree: true });

  let timedOut = false;
  timeoutId = setTimeout(() => {
    timedOut = true;
    callbacks.onTimeout?.();
  }, PLAYER_TIMEOUT_MS);

  const cleanup = () => {
    clearTimeout(timeoutId);
    observer.disconnect();
    container.replaceChildren();
    activeContainers.delete(container);
  };
  activeContainers.set(container, cleanup);

  callbacks.onCreated?.();
  void loadRumbleLoader().then(() => {
    if (!timedOut) getRumble()("play", { video: embedId, div: container.id });
  }).catch((error) => callbacks.onError?.(error));

  return cleanup;
}

export const RUMBLE_EMBED_LOADER_URL = RUMBLE_LOADER_URL;
export const RUMBLE_EMBED_PLAYER_LIMIT = MAX_PLAYERS;
export const RUMBLE_EMBED_TIMEOUT_MS = PLAYER_TIMEOUT_MS;
export const RUMBLE_OFFICIAL_LOADER_STUB = OFFICIAL_LOADER_STUB;
