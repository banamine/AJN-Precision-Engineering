/* Which media can go through the Web Audio bridge (compressor + visualizer).
 * The browser only lets Web Audio read a cross-origin file when it was loaded
 * with CORS. Three ways a source qualifies:
 *  1. same-origin (our proxies: /api/archive/proxy, /api/ajn/proxy)
 *  2. a host that sends Access-Control-Allow-Origin (listed below)
 *  3. HLS played through hls.js — segments arrive by XHR (already CORS) and
 *     the element plays a same-origin MediaSource blob.
 * Anything else plays natively without the bridge, never silently. */
import Hls from "hls.js";

/** AJN file hosts that send no CORS headers: routed through /api/ajn/proxy. */
export const AJN_PROXY_HOSTS = ["archive.alexjoneslive.com", "www.alexjoneslive.com"];
/** Hosts verified to send Access-Control-Allow-Origin: * (live AJN streams). */
export const CORS_HOSTS = ["stream.alexjones.media"];

export function bridgeSrc(src: string | undefined): string | undefined {
  if (!src) return src;
  try {
    const u = new URL(src);
    // Pluto playlists refuse other sites; segments/keys don't. Playlists only.
    if (u.protocol === "https:" && (u.hostname === "jmp2.uk" || u.hostname === "pluto.tv" || u.hostname.endsWith(".pluto.tv"))) {
      return `/api/hls/playlist?url=${encodeURIComponent(src)}`;
    }
    if (u.protocol === "https:" && !u.port && AJN_PROXY_HOSTS.includes(u.hostname)) {
      return `/api/ajn/proxy?url=${encodeURIComponent(src)}`;
    }
  } catch { /* relative URL */ }
  return src;
}

export function corsModeFor(src: string | undefined, isHls: boolean): "anonymous" | undefined {
  if (!src) return undefined;
  if (src.startsWith("/")) return "anonymous";
  if (isHls && Hls.isSupported()) return "anonymous";
  try { if (CORS_HOSTS.includes(new URL(src).hostname)) return "anonymous"; } catch { /* ignore */ }
  return undefined;
}
