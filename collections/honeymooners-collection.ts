/**
 * Deterministic Honeymooners collection manifest.
 *
 * Archive.org item identifiers are authoritative inputs for the AJN classic-TV
 * collection. Runtime asset discovery resolves playable MP4/M4V files from
 * each item's metadata record; this manifest never invents file names.
 */

export interface ArchiveCollectionItem {
  id: string;
  title: string;
  archiveIdentifier: string;
  archiveUrl: string;
  mediaType: 'video';
  collection: 'honeymooners';
}

const archiveItem = (id: string, title: string, archiveIdentifier: string): ArchiveCollectionItem => ({
  id,
  title,
  archiveIdentifier,
  archiveUrl: `https://archive.org/details/${archiveIdentifier}`,
  mediaType: 'video',
  collection: 'honeymooners',
});

export const HONEYMOONERS_COLLECTION_ID = 'honeymooners';
export const HONEYMOONERS_CHANNEL_ID = 'honeymooners';
export const HONEYMOONERS_CHANNEL_NAME = 'The Honeymooners';

export const HONEYMOONERS_COLLECTION: readonly ArchiveCollectionItem[] = [
  archiveItem('honeymooners-original-39', 'The Honeymooners S01 Original 39 Episodes', 'the-honeymooners-DVD'),
  archiveItem('honeymooners-classic-39-part1', 'The Honeymooners The Classic 39 Episodes (1955 1956) In HD (part 1)', 'TheHoneymoonersTheClassic39Episodes19551956InHDpart1'),
  archiveItem('honeymooners-classic-39-part5', 'The Honeymooners The Classic 39 Episodes (1955 1956) In HD (part 5)', 'TheHoneymoonersTheClassic39Episodes19551956InHDpart5'),
  archiveItem('honeymooners-spoof-jack-benny', 'Honeymooners Spoof', 'Jack_Benny_-_Honeymooners_Show'),
  archiveItem('honeymooners-957', '957 Honeymooners', '957-honeymooners'),
  archiveItem('honeymooners-red-skelton', "Red Skelton: Honeymooner's Spoof", 'RedSkeltonHoneymoonersSpoof'),
  archiveItem('honeymooners-35th-1990-convert', 'The Honeymooners 35th Anniversary Special (1990)', 'the-honeymooners-35th-anniversary-special-1990-convert-video-online.com'),
  archiveItem('honeymooners-35th', 'The Honeymooners 35th Anniversary Special', 'the-honeymooners-35th-anniversary-special'),
  archiveItem('honeymooners-wfld-1977', 'WFLD The Honeymooners A Matter Of Life And Death 1977', 'wfldthehoneymoonersamatteroflifeanddeath1977'),
  archiveItem('honeymooners-1954-11-20', 'The Honeymooners November 20, 1954', 'the-honeymooners-1954-11-20'),
  archiveItem('honeymooners-price-is-right-1960', 'The Price is Right - June 23, 1960 - Honeymooners Special', 'gsc-tpir-062360-062421-01'),
  archiveItem('honeymooners-1977-christmas', 'The Honeymooners 1977 Christmas Special', 'the-honeymooners-1977-christmas-special'),
  archiveItem('honeymooners-showtime-lost-episodes', 'Showtime "The Honeymooners Lost Episodes" Compilation July 1984', 'vimeo-506230231'),
] as const;

export const HONEYMOONERS_COLLECTION_FEED = {
  id: HONEYMOONERS_COLLECTION_ID,
  name: 'The Honeymooners Collection',
  channelId: HONEYMOONERS_CHANNEL_ID,
  channelName: HONEYMOONERS_CHANNEL_NAME,
  mediaType: 'video' as const,
  source: 'archive.org',
  itemCount: HONEYMOONERS_COLLECTION.length,
  items: HONEYMOONERS_COLLECTION,
};
