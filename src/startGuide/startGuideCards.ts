import type { Destination } from '../types';

export interface TourStep {
  title: string;
  body: string;
}

/** A real screenshot of the app, served from public/start-guide/. Optional: a card without one looks exactly as before. */
export interface GuideImage {
  src: string;
  alt: string;
  caption: string;
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
  image?: GuideImage;
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
    image: { src: '/start-guide/01-watch.png', alt: 'The Classic TV Broadcast Grid in the Live TV Guide, showing channel rows and a time header.', caption: 'Live TV Guide on Classic TV' },
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
    image: { src: '/start-guide/02-radio.png', alt: 'The Listen page with the live radio preset keys and the radio dock at the bottom.', caption: 'The Listen page with live presets' },
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
    image: { src: '/start-guide/03-find.png', alt: 'The TV News Search page showing broadcast news results.', caption: 'TV News Search with results' },
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
    image: { src: '/start-guide/04-headlines.png', alt: 'The News Wall on the Rumble tab with two live panels.', caption: 'The News Wall on the Rumble tab' },
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
    image: { src: '/start-guide/05-add-show.png', alt: 'The News Wall with the Paste a link tour step open.', caption: 'The News Wall, with the Paste a link step' },
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
    image: { src: '/start-guide/06-radio-schedule.png', alt: 'The Listen page on Archive Music with the 24-hour schedule deck on the right.', caption: 'Archive Music with the 24-hour schedule deck' },
  },
];
