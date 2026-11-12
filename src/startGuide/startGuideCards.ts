import type { Destination } from '../types';

export interface TourStep {
  title: string;
  body: string;
}

export interface GuideCard {
  id: 'watch' | 'radio' | 'find' | 'headlines' | 'sources' | 'schedule';
  emoji: string;
  title: string;
  blurb: string;
  openLabel: string;
  dest: Destination;
  tour: readonly [TourStep, TourStep];
  explain: {
    title: string;
    body: string;
    pills: readonly string[];
  };
}

export const GUIDE_CARDS: readonly GuideCard[] = [
  {
    id: 'watch',
    emoji: '📺',
    title: 'Watch television',
    blurb: 'Browse the 24-hour guide and see what is on right now.',
    openLabel: 'Open TV Guide',
    dest: 'tv-guide',
    tour: [
      { title: 'Open the guide', body: 'The Live TV Guide lists each channel with what is on now and next.' },
      { title: 'Pick a program', body: 'Select a program to start playing it.' },
    ],
    explain: {
      title: 'How television fits together',
      body: 'The Live TV Guide shows the schedule. Selecting a program sends it to the Player.',
      pills: ['Live TV Guide', 'Player'],
    },
  },
  {
    id: 'radio',
    emoji: '📻',
    title: 'Listen to radio or music',
    blurb: 'Tune live stations, or switch to Archive Music, Concerts, FM and Podcasts.',
    openLabel: 'Open Listen',
    dest: 'radio',
    tour: [
      { title: 'Pick a mode', body: 'Choose Live for stations, Archive for music, concerts and FM, or Podcasts.' },
      { title: 'Play something', body: 'Select a station or an item to start it, or press a preset key.' },
    ],
    explain: {
      title: 'How radio fits together',
      body: 'The Listen page plays through the radio dock. Minimise the dock and the radio keeps playing.',
      pills: ['Listen page', 'Radio dock'],
    },
  },
  {
    id: 'find',
    emoji: '🔍',
    title: 'Find a show or news clip',
    blurb: 'Search TV News by keyword.',
    openLabel: 'Open Search',
    dest: 'search',
    tour: [
      { title: 'Type a keyword', body: 'Enter a name, topic or phrase in the search box.' },
      { title: 'Open a result', body: 'Select a result to play it.' },
    ],
    explain: {
      title: 'How search fits together',
      body: 'Search looks through TV News and sends the result you choose to the Player.',
      pills: ['Search', 'Player'],
    },
  },
  {
    id: 'headlines',
    emoji: '📰',
    title: 'Read the headlines',
    blurb: 'Rumble, YouTube and Banned Video walls, plus the News Cube.',
    openLabel: 'Open News',
    dest: 'news',
    tour: [
      { title: 'Choose a wall', body: 'Use the tabs to switch between Rumble, YouTube and Banned Video.' },
      { title: 'Try the News Cube', body: 'Open More, then News Cube, to see the Daily News Digest in a six-face cube.' },
    ],
    explain: {
      title: 'How news fits together',
      body: 'The News page groups the Rumble, YouTube and Banned Video walls. The News Cube shows the Daily News Digest headlines.',
      pills: ['News tabs', 'News Cube'],
    },
  },
  {
    id: 'sources',
    emoji: '➕',
    title: 'Add a show to a news wall',
    blurb: 'Paste a YouTube playlist link, or import a Rumble export.',
    openLabel: 'Open News',
    dest: 'news',
    tour: [
      { title: 'Open the YouTube tab', body: 'On the News page, choose the YouTube tab.' },
      { title: 'Paste a link', body: 'Paste a YouTube playlist link into the field and press Add show. Rumble channels are updated from the import box on the Rumble tab.' },
    ],
    explain: {
      title: 'How added shows work',
      body: 'A YouTube playlist link you add becomes a show on the YouTube wall. Rumble updates come from pasting an export into the import box.',
      pills: ['YouTube tab', 'Add show', 'Rumble import box'],
    },
  },
  {
    id: 'schedule',
    emoji: '🗓️',
    title: 'See the radio schedule',
    blurb: 'Archive Music, Concerts, FM and Podcasts each show a 24-hour schedule deck.',
    openLabel: 'Open Listen',
    dest: 'radio',
    tour: [
      { title: 'Leave Live', body: 'In Listen, switch from Live to Archive or Podcasts.' },
      { title: 'Read the schedule deck', body: 'The right-hand panel lists what plays next and later.' },
    ],
    explain: {
      title: 'How the schedule deck works',
      body: 'The schedule deck lists what plays next for the selected group. It shows the schedule; it does not edit it.',
      pills: ['Listen page', 'Schedule deck'],
    },
  },
];
