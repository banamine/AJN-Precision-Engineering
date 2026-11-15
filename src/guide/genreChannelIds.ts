/* The 8 genre 24/7 channels (5 TV + 3 movie). Pure data: no React, no DOM, no JSON publications, safe for client and server.
 * Ids are stable: never rename. Pills use the labels of GENRE in genreBuckets.ts (TV channels only; the Movies guide keeps its own pills). */
export interface GenreChannelMeta { id: string; name: string; guideId: 'classic-tv' | 'movies-classics-vault'; group: 'Classic TV' | 'Movies'; pills: string[] }
export const GENRE_CHANNELS: readonly GenreChannelMeta[] = [
  { id: 'ajn247-sitcoms', name: 'AJN Classic Sitcoms & Family Comedy', guideId: 'classic-tv', group: 'Classic TV', pills: ['Comedy'] },
  { id: 'ajn247-crime', name: 'AJN Crime, Detective & Mystery', guideId: 'classic-tv', group: 'Classic TV', pills: ['Crime & Mystery'] },
  { id: 'ajn247-scifi', name: 'AJN Sci-Fi, Mystery & Anthology', guideId: 'classic-tv', group: 'Classic TV', pills: ['Sci-Fi', 'Horror & Thriller'] },
  { id: 'ajn247-action', name: 'AJN Action & Adventure TV', guideId: 'classic-tv', group: 'Classic TV', pills: ['Action & Adventure'] },
  { id: 'ajn247-cartoons', name: 'AJN Saturday Cartoons & Animation', guideId: 'classic-tv', group: 'Classic TV', pills: ['Cartoons', 'Family & Kids'] },
  { id: 'ajn247-movies-action-western', name: 'AJN Classic Movies: Action, Adventure & Westerns', guideId: 'movies-classics-vault', group: 'Movies', pills: [] },
  { id: 'ajn247-movies-scifi-horror', name: 'AJN Classic Movies: Sci-Fi, Horror & Thrillers', guideId: 'movies-classics-vault', group: 'Movies', pills: [] },
  { id: 'ajn247-movies-comedy-drama-noir', name: 'AJN Classic Movies: Comedy, Drama & Noir', guideId: 'movies-classics-vault', group: 'Movies', pills: [] },
];
export const GENRE_CHANNEL_IDS: ReadonlySet<string> = new Set(GENRE_CHANNELS.map(c => c.id));
export const isGenreChannelId = (id: string): boolean => GENRE_CHANNEL_IDS.has(id);
