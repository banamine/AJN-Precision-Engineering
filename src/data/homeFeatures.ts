import type { Destination, MediaType } from '../types';

// Pools for the Home page daily rotation (src/utils/dayRotation.ts). To add a feature or a tile, add one entry here;
// the rotation picks from whatever is in these lists. Every archivePath must be a real, playable Archive path.

export interface HeroFeature {
  id: string; title: string; category: string; description: string; archivePath: string;
  duration: string; tag: string; mediaType: MediaType; image: string; apollo?: boolean;
}

export const HERO_POOL: HeroFeature[] = [
  { id: 'apollo-11', title: 'NASA Apollo 11 Spaceflight Audio Highlights', category: 'Historic Aerospace Vault', description: 'Original transmission feeds from the Apollo 11 lunar landing mission, processed through the AJN precision audio bridge.', archivePath: '/download/Apollo11AudioHighlights/Apollo11Highlights.mp3', duration: '61 mins', tag: 'Curated Feature', mediaType: 'audio', image: '/Classic%20Archive.png', apollo: true },
  { id: 'night-of-the-living-dead', title: 'Night of the Living Dead (1968 Master)', category: 'Public Domain Cinema', description: 'Classic cinema restored master streamed through the existing Archive playback path.', archivePath: '/download/night_of_the_living_dead_dvd/Night.mp4', duration: '96 mins', tag: 'Curated Feature', mediaType: 'video', image: '/Classic%20Archive.png' },
  { id: 'war-of-the-worlds-1938', title: 'War of the Worlds — Orson Welles 1938', category: 'Historical Radio Drama', description: 'The historic CBS broadcast with live sound design and voice acting.', archivePath: '/download/WarOfTheWorlds1938RadioBroadcast256kbps/War-of-the-Worlds-1938-Radio-Broadcast-136kbps-cleaned.mp3', duration: '58 mins', tag: 'Curated Feature', mediaType: 'audio', image: '/Classic%20Archive.png' },
];

export interface ProgramTile {
  id: string; title: string; description: string; badge: string; accent: string; dest: Destination;
  /** Static artwork when there is some; genre tiles without artwork use the cover of what is airing in that guide. */
  image?: string;
  /** Guide to open on the TV Guide, and whose on-now cover to borrow when there is no artwork. */
  guideId?: string;
  /** Open the guide and land on this channel (by stable channel id, never by station number: numbers are alphabetical positions and shift). */
  focusChannelId?: string;
  /** Always shown (takes one of the three tile slots) instead of joining the daily rotation. */
  pinned?: boolean;
}

export const PROGRAM_POOL: ProgramTile[] = [
  { id: 'special', title: 'Special Coverage', description: 'Archive reports, breaking coverage and preserved broadcast material.', badge: 'SPECIAL REPORT', accent: 'text-sky-300', dest: 'library', image: '/Special%20Report.png' },
  { id: 'classic', title: 'Classic Archive', description: 'Classic television, cinema and historical programs.', badge: 'CLASSIC TV', accent: 'text-amber-300', dest: 'library', image: '/Classic%20Archive.png' },
  { id: 'emergency', title: 'Emergency Broadcast', description: 'Continuous-access emergency and special broadcast presentation.', badge: 'EMERGENCY', accent: 'text-rose-300', dest: 'tv-guide', image: '/Emergency%20Broadcast.png' },
  { id: 'documentaries', title: 'Documentaries', description: 'Science and history documentaries from verified Archive manifests.', badge: 'DOCUMENTARIES', accent: 'text-emerald-300', dest: 'tv-guide', guideId: 'science-documentaries' },
  { id: 'movies', title: 'Movies & Cinema', description: 'Classic cinema in the 24-hour movie guide.', badge: 'CINEMA', accent: 'text-orange-300', dest: 'tv-guide', guideId: 'movies-classics-vault' },
  { id: 'audio', title: 'Radio & Music', description: 'Talk radio, music collections, podcasts and old-time radio.', badge: 'AUDIO', accent: 'text-cyan-300', dest: 'radio', guideId: 'audio-podcasts' },
  { id: 'classic-ajn-archive-1', title: 'AJN archive 1', description: 'Classic TV on the broadcast grid: open the guide right at this channel.', badge: 'CLASSIC TV · CHANNEL', accent: 'text-amber-400', dest: 'tv-guide', guideId: 'classic-tv', focusChannelId: 'classic-ajn-archive-1', pinned: true, image: '/Classic%20Archive.png' },
  { id: 'british', title: 'Old British TV', description: 'British dramas, comedies and children’s television.', badge: 'BRITISH TV', accent: 'text-violet-300', dest: 'tv-guide', guideId: 'old-british-tv' },
];
