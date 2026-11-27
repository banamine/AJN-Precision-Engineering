/* Show artwork by channel id. The guide, the Listen catalog and Listen Alerts each already know a show's feed artwork; the player is started
 * with no picture, so it asks here. Only artwork a feed really supplied is kept; no art means no entry (the UI then draws initials). */
const arts = new Map<string, string>();
const MAX = 400;
export function rememberPodcastArt(channelId: string | null | undefined, logo: string | null | undefined): void {
  if (!channelId || !logo || typeof logo !== 'string' || !/^(https?:)?\/\//i.test(logo) && !logo.startsWith('/')) return;
  if (!arts.has(channelId) && arts.size >= MAX) return;
  arts.set(channelId, logo);
}
export function rememberChannelArts(channels: unknown): void {
  if (!Array.isArray(channels)) return;
  for (const c of channels as { id?: unknown; logo?: unknown }[]) {
    if (c && typeof c.id === 'string' && c.id.startsWith('pod-') && typeof c.logo === 'string') rememberPodcastArt(c.id, c.logo);
  }
}
export function podcastArtFor(channelId: string | null | undefined): string | undefined { return channelId ? arts.get(channelId) : undefined; }
export function resetPodcastArtForTests(): void { arts.clear(); }
/** Two-letter stand-in when a show has no artwork. */
export function initialsOf(name: string | undefined | null): string {
  return String(name ?? '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '•';
}
