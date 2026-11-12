/* Neural Twin node glyphs. Stroke-only 24x24 SVG inner markup (drawn with stroke="currentColor"), one glyph per part so a node
 * shows what it is, not just a ball. Static constants only: no data, no telemetry. */
export const ICONS: Record<string, string> = {
  speaker: `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>`,
  dial: `<circle cx="12" cy="12" r="9"></circle><path d="M12 12L16 8"></path>`,
  deck: `<rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="6" cy="12" r="2"></circle><circle cx="18" cy="12" r="2"></circle><path d="M10 12h4"></path>`,
  wave: `<path d="M2 12h3l3-8 4 16 4-10 2 4h4"></path>`,
  tv: `<rect x="2" y="7" width="20" height="14" rx="2"></rect><path d="M17 2l-5 5-5-5"></path>`,
  film: `<rect x="2" y="2" width="20" height="20" rx="2.18"></rect><path d="M7 2v20"></path><path d="M17 2v20"></path><path d="M2 12h20"></path><path d="M2 7h5"></path><path d="M2 17h5"></path><path d="M17 7h5"></path><path d="M17 17h5"></path>`,
  jingle: `<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>`,
  link: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>`,
  calendar: `<rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path>`,
  grid: `<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>`,
  search: `<circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path>`,
  db: `<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>`,
  newspaper: `<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path><path d="M18 14h-8"></path><path d="M18 18h-8"></path><path d="M18 6h-8"></path>`,
  ticker: `<path d="M2 12h20"></path><path d="M6 8l-4 4 4 4"></path><path d="M18 8l4 4-4 4"></path>`,
  rss: `<path d="M4 11a9 9 0 0 1 9 9"></path><path d="M4 4a16 16 0 0 1 16 16"></path><circle cx="5" cy="19" r="1"></circle>`,
  shield: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>`,
  radio: `<circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"></path>`,
  clock: `<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>`,
  git: `<circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 9v12"></path><path d="M18 9a9 9 0 0 1-9 9"></path>`,
  wrench: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>`,
  key: `<circle cx="7.5" cy="16.5" r="2.5"></circle><path d="M21 2l-2 2m-1.5 1.5L16 4l-2 2 1.5 1.5-3 3a6 6 0 1 1-2.83-2.83l3-3L14 3l-1.5-1.5L14 0l4 4-2 2z"></path>`,
  input: `<polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line>`,
  camera: `<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle>`,
  cover: `<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>`,
  cloud: `<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>`
};

/** Every neuron id in topology.ts -> a glyph name in ICONS. A test asserts this stays exhaustive. */
export const NEURON_ICON: Record<string, string> = {
  'minimal-player': 'speaker',
  'radio-presets': 'dial',
  'mini-player-dock': 'deck',
  'radio-spectrum': 'wave',
  'schedule-deck': 'calendar',
  'player-view': 'film',
  'buffer-jingle': 'jingle',
  'av-sync': 'link',
  'tv-guide': 'tv',
  'rumble-wall': 'grid',
  'registry-csv': 'db',
  'actor-director-graph': 'link',
  'library-index': 'search',
  'shared-search': 'input',
  'concert-manifest': 'db',
  'fm-manifest': 'radio',
  'daily-digest-json': 'newspaper',
  'news-cube': 'grid',
  'daily-briefing': 'ticker',
  'news-rss-sources': 'rss',
  'safe-fetch': 'shield',
  'radio-now-playing': 'radio',
  'podcast-sources': 'rss',
  'status-external-fetch': 'clock',
  'status-cache-payload': 'db',
  'github-repo-sync': 'git',
  'github-digest-collector': 'git',
  'manifest-ingest': 'wrench',
  'ui-rocker': 'key',
  'ui-ghost-input': 'input',
  'tracker-tv': 'camera',
  'tracker-podcast': 'cover',
};

export function iconSvg(neuronId: string, size = 14): string {
  const glyph = ICONS[NEURON_ICON[neuronId] ?? 'cloud'] ?? ICONS.cloud;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph}</svg>`;
}
