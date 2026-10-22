/**
 * Central channel configuration for live-radio stations: ONE place that says what each station is called, which logo it
 * shows, and which colours it wears. Every radio surface (directory, presets, group, dock, mini player, full player)
 * reads it through getStationTheme(), so a colour is changed here and nowhere else.
 *
 *   id            station id from the directory ("radio:...")
 *   name          display name
 *   icon          logo URL. Not listed here: the real logo comes from the directory record (stationArt.ts) and is passed
 *                 to getStationTheme(); with no logo the emoji below is shown. Nothing is invented.
 *   accentColor   the station's own colour (borders, tags, dots)
 *   themeColor    its deep background tone (gradients behind the player)
 */

export interface StationChannelConfig {
  id: string;
  name: string;
  /** Optional fixed logo; otherwise the directory's own logo is used. */
  icon?: string;
  accentColor: string;
  themeColor: string;
  shortTag: string;
  textClass: string;
  iconEmoji: string;
  category: string;
}

export const STATION_CHANNELS: StationChannelConfig[] = [
  { id: 'radio:rb-34135e58-c4b4-4aaa-89b3-c42254ba7307', name: 'Classic Hits 109', shortTag: '70s-90s', accentColor: '#F59E0B', themeColor: '#3A2606', textClass: 'text-amber-400', iconEmoji: '📻', category: 'Classic Hits' },
  { id: 'radio:rb-c1cf4123-bf67-4058-a89a-70008a531976', name: 'Country Hits', shortTag: 'Country', accentColor: '#F97316', themeColor: '#3B1A07', textClass: 'text-orange-400', iconEmoji: '🤠', category: 'Country' },
  { id: 'radio:rb-c4481bd4-0a22-44f5-bec0-1b2556ddbe89', name: 'Yacht Rock', shortTag: 'Yacht', accentColor: '#06B6D4', themeColor: '#06303A', textClass: 'text-cyan-400', iconEmoji: '⛵', category: 'Soft Rock' },
  { id: 'radio:ch109-original', name: 'The Original', shortTag: 'Original', accentColor: '#A855F7', themeColor: '#2E1245', textClass: 'text-purple-400', iconEmoji: '🎙️', category: 'Oldies' },
  { id: 'radio:ch109-classic-rock-109', name: 'Classic Rock 109', shortTag: 'Rock', accentColor: '#EF4444', themeColor: '#3F1010', textClass: 'text-red-400', iconEmoji: '⚡', category: 'Rock' },
  { id: 'radio:ch109-warm-109', name: 'Warm 109', shortTag: 'Warm', accentColor: '#FB7185', themeColor: '#3F1620', textClass: 'text-rose-400', iconEmoji: '☕', category: 'Easy Listening' },
  { id: 'radio:ch109-summertime-hits', name: 'Summertime Hits', shortTag: 'Summer', accentColor: '#EAB308', themeColor: '#392D05', textClass: 'text-yellow-400', iconEmoji: '☀️', category: 'Pop' },
  { id: 'radio:ch109-one-hit-wonders', name: 'One Hit Wonders', shortTag: '1-Hit', accentColor: '#6366F1', themeColor: '#1B1D4A', textClass: 'text-indigo-400', iconEmoji: '🌟', category: 'Hits' },
  { id: 'radio:ch109-christmas', name: 'Christmas', shortTag: 'Holiday', accentColor: '#10B981', themeColor: '#06301F', textClass: 'text-emerald-400', iconEmoji: '🎄', category: 'Holiday' },
];

export interface StationTheme {
  id: string;
  /** Display name (same as label). */
  name: string;
  label: string;
  shortTag: string;
  /** Accent colour (same as accentColor; kept as `color` for existing callers). */
  color: string;
  accentColor: string;
  /** Deep background tone for gradients. */
  themeColor: string;
  bgTint: string;        // translucent accent, for chips
  borderTint: string;    // translucent accent, for borders
  textClass: string;
  iconEmoji: string;
  /** The station's real logo URL (https), or undefined: callers then show iconEmoji. */
  icon?: string;
  category: string;
}

const VIBRANT_PALETTE = [
  { color: '#F59E0B', textClass: 'text-amber-400', emoji: '📻' },
  { color: '#06B6D4', textClass: 'text-cyan-400', emoji: '🌊' },
  { color: '#EC4899', textClass: 'text-pink-400', emoji: '🎵' },
  { color: '#8B5CF6', textClass: 'text-violet-400', emoji: '🎧' },
  { color: '#10B981', textClass: 'text-emerald-400', emoji: '🌿' },
  { color: '#F97316', textClass: 'text-orange-400', emoji: '🔥' },
  { color: '#3B82F6', textClass: 'text-blue-400', emoji: '⚡' },
  { color: '#14B8A6', textClass: 'text-teal-400', emoji: '✨' },
  { color: '#F43F5E', textClass: 'text-rose-400', emoji: '❤️' },
  { color: '#84CC16', textClass: 'text-lime-400', emoji: '⭐' },
];

/** "#RRGGBB" mixed toward near-black: the deep background tone derived from an accent when none is configured. */
export function deriveThemeColor(hex: string, keep = 0.22): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#14110d';
  const n = parseInt(m[1], 16);
  const base = 12;
  const ch = (v: number) => Math.round(base + (v - base) * keep).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const httpsOnly = (u?: string | null): string | undefined => (u && /^https:\/\//i.test(u) ? u : undefined);
const byId = new Map(STATION_CHANNELS.map((c) => [c.id, c]));

/** Theme for any radio station. Known stations use STATION_CHANNELS; every other station gets a stable colour from its id. */
export function getStationTheme(stationId: string, fallbackName = '', logo?: string | null): StationTheme {
  const known = byId.get(stationId);
  const icon = httpsOnly(logo) ?? httpsOnly(known?.icon);
  if (known) {
    return {
      id: stationId, name: known.name, label: known.name, shortTag: known.shortTag,
      color: known.accentColor, accentColor: known.accentColor, themeColor: known.themeColor,
      bgTint: `${known.accentColor}2E`, borderTint: `${known.accentColor}B3`,
      textClass: known.textClass, iconEmoji: known.iconEmoji, icon, category: known.category,
    };
  }
  let hash = 0;
  const key = stationId || fallbackName;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const picked = VIBRANT_PALETTE[hash % VIBRANT_PALETTE.length];
  const shortTag = fallbackName.replace(/[^A-Za-z0-9]/g, ' ').trim().split(/\s+/)[0] || 'RADIO';
  return {
    id: stationId, name: fallbackName || 'Radio Station', label: fallbackName || 'Radio Station', shortTag: shortTag.slice(0, 7).toUpperCase(),
    color: picked.color, accentColor: picked.color, themeColor: deriveThemeColor(picked.color),
    bgTint: `${picked.color}25`, borderTint: `${picked.color}80`,
    textClass: picked.textClass, iconEmoji: picked.emoji, icon, category: 'Live Radio',
  };
}

/** Background gradient in the station's colours: deep theme tone fading into a wash of the accent. */
export function stationGradient(theme: Pick<StationTheme, 'themeColor' | 'accentColor'>): string {
  return `linear-gradient(135deg, ${theme.themeColor} 0%, ${theme.themeColor} 55%, ${theme.accentColor}38 100%)`;
}
