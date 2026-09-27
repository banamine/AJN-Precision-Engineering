/* Playlist-only HLS proxy for providers whose *playlists* refuse other sites
 * (Pluto's stitcher answers Access-Control-Allow-Origin: http://pluto.tv) while
 * their segments and AES keys are open (Access-Control-Allow-Origin: *).
 * Only the small .m3u8 text passes through here; video segments and keys are
 * rewritten to absolute URLs and fetched by the browser directly. */

/** Hosts whose playlists we may fetch (no open proxy). */
export function hlsProxyAllowed(host: string): boolean {
  return host === 'jmp2.uk' || host === 'pluto.tv' || host.endsWith('.pluto.tv');
}

const PROXY = '/api/hls/playlist?url=';
const isPlaylist = (u: string) => /\.m3u8(\?|$)/i.test(u) || /\/playlist(\?|$)/i.test(u) || /\/master(\.m3u8)?(\?|$)/i.test(u);

/** Rewrite a playlist so nested playlists come back through us and everything
 *  else (segments, keys, init maps) is an absolute direct URL. */
export function rewritePlaylist(text: string, baseUrl: string): string {
  const abs = (u: string) => new URL(u, baseUrl).toString();
  const route = (u: string) => {
    const a = abs(u);
    return isPlaylist(a) && hlsProxyAllowed(new URL(a).hostname) ? PROXY + encodeURIComponent(a) : a;
  };
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${route(u)}"`);
    return route(t);
  }).join('\n');
}
