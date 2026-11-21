/* Pure logic for the Shows genre tiles (Dusk skin): one tile per genre pill of the open channel, with the REAL show count.
 * The tile colour is a stable function of the genre name (no random values), dark enough for white text at >= 4.5:1. */
export interface TileShow { channelId: string; pill: string }
export interface GenreTile { pill: string; count: number; gradient: string }

export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}
export const tileColors = (name: string): [string, string] => { const h = hueOf(name); return [`hsl(${h} 52% 26%)`, `hsl(${(h + 38) % 360} 56% 16%)`]; };

export function genreTiles(shows: readonly TileShow[], channelId: string, pills: readonly string[]): GenreTile[] {
  return pills.map((pill) => {
    const [a, b] = tileColors(pill);
    return { pill, count: shows.filter((s) => s.channelId === channelId && s.pill === pill).length, gradient: `linear-gradient(135deg, ${a}, ${b})` };
  });
}
