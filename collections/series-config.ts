/* Multi-season series channels. Each series lists every Archive item that holds its episodes, so a show spread over
 * several items (Taxi: one item per season) becomes ONE channel with all seasons in order.
 * The episode lists are generated, offline, by scripts/series-manifest.ts into src/data/seriesManifests.json;
 * nothing here calls Archive at runtime. */
export interface SeriesItemConfig {
  identifier: string;
  /** Season for items whose file names carry no season marker (Taxi's last season uses "Episode N <title>"). */
  seasonHint?: number;
  /** 'sxx': file names end in a 3-digit code where the first digit is the season (the.protectors.101 = S1E01). */
  numbering?: 'sxx';
}
export interface SeriesConfig {
  /** Stable key, also the manifest key. */
  key: string;
  channelId: string;
  name: string;
  /** Series name used in program titles. */
  series: string;
  group: string;
  items: SeriesItemConfig[];
}

import { LIST4_BATCH1 } from './series-config-list4';

export const ZIPMEMBER_SERIES_CONFIG: SeriesConfig[] = [
  {
    key: 'sc-babylon-5',
    channelId: 'sc-babylon-5',
    name: 'Babylon 5',
    series: 'Babylon 5',
    group: 'Classic TV',
    items: [],
  },
  {
    key: 'sc-agents-of-shield',
    channelId: 'sc-agents-of-shield',
    name: "Marvel's Agents of S.H.I.E.L.D.",
    series: "Marvel's Agents of S.H.I.E.L.D.",
    group: 'Classic TV',
    items: [],
  },
  {
    key: 'sc-star-trek-ds9',
    channelId: 'sc-star-trek-ds9',
    name: 'Star Trek: Deep Space Nine',
    series: 'Star Trek: Deep Space Nine',
    group: 'Classic TV',
    items: [],
  },
  {
    key: 'sc-stargate-atlantis',
    channelId: 'sc-stargate-atlantis',
    name: 'Stargate Atlantis',
    series: 'Stargate Atlantis',
    group: 'Classic TV',
    items: [],
  },
];

export const SERIES_CONFIG: SeriesConfig[] = [
  {
    key: 'taxi', channelId: 'classic-series-taxi', name: 'Taxi — All Seasons', series: 'Taxi', group: 'Classic TV',
    items: [
      { identifier: 'Taxi1x14SugarMama', seasonHint: 1 },
      { identifier: 'TaxiS02E08TheGreatRace', seasonHint: 2 },
      { identifier: 'TaxiS03E07TheCallOfTheMild', seasonHint: 3 },
      { identifier: 'TaxiS04E12BobbyDoesntLiveHereAnymore', seasonHint: 4 },
      { identifier: 'Episode1TheShloogelShowLoveUnAmericanStyle', seasonHint: 5 },
    ],
  },
  {
    key: 'hogans-heroes', channelId: 'classic-series-hogans-heroes', name: "Hogan's Heroes — Archive set", series: "Hogan's Heroes", group: 'Classic TV',
    items: [{ identifier: 'hogans-heroes-s-01-e-01-the-informer_202509' }],
  },
  ...LIST4_BATCH1,
  ...ZIPMEMBER_SERIES_CONFIG,
];
