import fs from 'node:fs';
import path from 'node:path';
import type { Program } from '../src/types';
import {
  localInstant,
  zonedParts,
  dateKey,
  addDays,
  HOUR,
  type NetworkAsset,
  type NetworkCatalog,
} from '../server/classicNetwork';

interface DraftConfig {
  stationZone: string;
  originMonday: string;
  horizonDays: number;
  activeFrom: string;
  repeatGapHours: number;
  pools: Record<string, {
    series: string[];
    mode?: string;
    runMin?: number;
    runMax?: number;
    endWith?: string;
    targetRatio?: number;
    countPerNight?: number;
  }>;
}

const config = JSON.parse(fs.readFileSync('config/classic-network-draft.json', 'utf8')) as DraftConfig;
const catalog = JSON.parse(fs.readFileSync('src/data/classicNetworkCatalog.json', 'utf8')) as NetworkCatalog;

const zone = config.stationZone;
const gapMs = config.repeatGapHours * HOUR;

// Group assets by show
const byShow = new Map<string, NetworkAsset[]>();
for (const a of catalog.assets) {
  const list = byShow.get(a.show) ?? [];
  list.push(a);
  byShow.set(a.show, list);
}

// Cursors and repeat tracking
const cursors = new Map<string, number>();
const lastStarts = new Map<string, number>();

function getNextAsset(show: string, now: number): NetworkAsset {
  const list = byShow.get(show);
  if (!list || !list.length) throw new Error(`Empty catalog for show: ${show}`);
  const startIdx = cursors.get(show) ?? 0;
  for (let offset = 0; offset < list.length; offset++) {
    const idx = (startIdx + offset) % list.length;
    const candidate = list[idx];
    const prev = lastStarts.get(candidate.episodeKey);
    if (prev === undefined || (now - prev) >= gapMs) {
      cursors.set(show, (idx + 1) % list.length);
      return candidate;
    }
  }
  throw new Error(`168h repeat gate exhausted for show: ${show} at ${new Date(now).toISOString()}`);
}

const pre1960Shows = config.pools['cartoons-pre1960'].series;
const pre1960Lists = pre1960Shows.map(s => byShow.get(s) ?? []);
const pre1960Assets: NetworkAsset[] = [];
const maxPreLen = Math.max(...pre1960Lists.map(l => l.length));
for (let i = 0; i < maxPreLen; i++) {
  for (const list of pre1960Lists) {
    if (i < list.length) pre1960Assets.push(list[i]);
  }
}
let pre1960AssetIdx = 0;

const inEraShows = config.pools['cartoons-inera'].series;
const inEraLists = inEraShows.map(s => byShow.get(s) ?? []);
const inEraAssets: NetworkAsset[] = [];
const maxInLen = Math.max(...inEraLists.map(l => l.length));
for (let i = 0; i < maxInLen; i++) {
  for (const list of inEraLists) {
    if (i < list.length) inEraAssets.push(list[i]);
  }
}
let inEraAssetIdx = 0;

function getNextCartoonAsset(pre1960: boolean, now: number): NetworkAsset {
  const list = pre1960 ? pre1960Assets : inEraAssets;
  const startIdx = pre1960 ? pre1960AssetIdx : inEraAssetIdx;
  for (let offset = 0; offset < list.length; offset++) {
    const idx = (startIdx + offset) % list.length;
    const candidate = list[idx];
    const prev = lastStarts.get(candidate.episodeKey);
    if (prev === undefined || (now - prev) >= gapMs) {
      if (pre1960) pre1960AssetIdx = (idx + 1) % list.length;
      else inEraAssetIdx = (idx + 1) % list.length;
      return candidate;
    }
  }
  throw new Error(`168h repeat gate exhausted for ${pre1960 ? 'pre-1960' : 'in-era'} cartoons at ${new Date(now).toISOString()}`);
}

const startMs = localInstant(config.originMonday, '00:00', zone);
const endMs = localInstant(addDays(config.originMonday, config.horizonDays), '00:00', zone);

let currentMs = startMs;
const programs: Program[] = [];

let cartoonPre1960Seconds = 0;
let cartoonInEraSeconds = 0;

const daytimePool = config.pools['daytime-single'].series;
let daytimeIdx = 0;

const overnightPool = config.pools['overnight'].series;
let overnightIdx = 0;

const westernShows = config.pools['weekend-westerns'].series;
let westernIdx = 0;

const mysteryShows = config.pools['sunday-mystery'].series;
let mysteryIdx = 0;

function scheduleAsset(asset: NetworkAsset, start: number): Program {
  const durMs = Math.round(asset.durationSeconds * 1000);
  const end = start + durMs;
  const prev = lastStarts.get(asset.episodeKey);
  if (prev !== undefined && (start - prev) < gapMs) {
    throw new Error(`Repeat gate violated for ${asset.episodeKey}: ${start - prev}ms < ${gapMs}ms`);
  }
  lastStarts.set(asset.episodeKey, start);

  const occurrenceId = `preview:${asset.episodeKey}:${start}`;
  const program: Program = {
    id: occurrenceId,
    assetId: asset.assetId,
    guideId: 'classic-tv',
    channelId: 'classic-network',
    title: asset.title,
    startTime: 0,
    endTime: asset.durationSeconds / 3600,
    startTimeUtc: new Date(start).toISOString(),
    endTimeUtc: new Date(end).toISOString(),
    mediaType: 'video',
    mediaUrl: asset.archivePath,
    archivePath: asset.archivePath,
    sourceClass: 'archive_org',
    isArchivedSource: true,
    metadata: {
      epg: 'utc',
      scheduledVod: true,
      stationZone: zone,
      episodeKey: asset.episodeKey,
      assetId: asset.assetId,
      occurrenceId,
      show: asset.show,
      ...(asset.season !== undefined ? { season: asset.season, episode: asset.episode } : {}),
      durationSeconds: asset.durationSeconds,
    },
  };
  programs.push(program);
  return program;
}

// 14 Station Days loop
for (let dayOffset = 0; dayOffset < config.horizonDays; dayOffset++) {
  const dayStr = addDays(config.originMonday, dayOffset);
  const dayOfWeek = (new Date(`${dayStr}T12:00:00Z`).getUTCDay()); // 0=Sun, 1=Mon, ..., 6=Sat
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
  const isSunday = (dayOfWeek === 0);

  const dayStartMs = localInstant(dayStr, '00:00', zone);
  const morningMs = localInstant(dayStr, '06:00', zone);
  const middayMs = localInstant(dayStr, '12:00', zone);
  const eveningMs = localInstant(dayStr, '18:00', zone);
  const nextDayMs = localInstant(addDays(dayStr, 1), '00:00', zone);

  // 1. Overnight (00:00 - 06:00): Single episodes of deep comedy pool
  while (currentMs < morningMs) {
    const show = overnightPool[overnightIdx % overnightPool.length];
    overnightIdx++;
    const asset = getNextAsset(show, currentMs);
    scheduleAsset(asset, currentMs);
    currentMs += Math.round(asset.durationSeconds * 1000);
  }

  // 2. Morning (06:00 - 12:00)
  if (isWeekend) {
    // Weekend Cartoons: target 60% pre-1960 airtime
    while (currentMs < middayMs) {
      const totalCartoonSec = cartoonPre1960Seconds + cartoonInEraSeconds;
      const currentRatio = totalCartoonSec > 0 ? (cartoonPre1960Seconds / totalCartoonSec) : 0;
      const wantPre1960 = (currentRatio < 0.60);
      const asset = getNextCartoonAsset(wantPre1960, currentMs);
      if (wantPre1960) cartoonPre1960Seconds += asset.durationSeconds;
      else cartoonInEraSeconds += asset.durationSeconds;
      scheduleAsset(asset, currentMs);
      currentMs += Math.round(asset.durationSeconds * 1000);
    }
  } else {
    // Weekday Daytime Part 1 (06:00 - 12:00): Single episodes only
    while (currentMs < middayMs) {
      const show = daytimePool[daytimeIdx % daytimePool.length];
      daytimeIdx++;
      const asset = getNextAsset(show, currentMs);
      scheduleAsset(asset, currentMs);
      currentMs += Math.round(asset.durationSeconds * 1000);
    }
  }

  // 3. Midday (12:00 - 18:00): Single episodes only
  while (currentMs < eveningMs) {
    const show = daytimePool[daytimeIdx % daytimePool.length];
    daytimeIdx++;
    const asset = getNextAsset(show, currentMs);
    scheduleAsset(asset, currentMs);
    currentMs += Math.round(asset.durationSeconds * 1000);
  }

  // 4. Evening (18:00 - 24:00)
  if (isSunday) {
    // Sunday: 2 Mystery Wheel episodes, then 2 Westerns, then prime runs ending with Hogan's (max 3)
    for (let i = 0; i < 2; i++) {
      const show = mysteryShows[mysteryIdx % mysteryShows.length];
      mysteryIdx++;
      const asset = getNextAsset(show, currentMs);
      scheduleAsset(asset, currentMs);
      currentMs += Math.round(asset.durationSeconds * 1000);
    }
    for (let i = 0; i < 2; i++) {
      const show = westernShows[westernIdx % westernShows.length];
      westernIdx++;
      const asset = getNextAsset(show, currentMs);
      scheduleAsset(asset, currentMs);
      currentMs += Math.round(asset.durationSeconds * 1000);
    }
    // Mid-evening prime run of M*A*S*H or Taxi (1-2 episodes) if time permits
    if ((nextDayMs - currentMs) > 85 * 60 * 1000) {
      for (let i = 0; i < 2; i++) {
        const asset = getNextAsset('mash', currentMs);
        scheduleAsset(asset, currentMs);
        currentMs += Math.round(asset.durationSeconds * 1000);
      }
    }
    // Closing run: Hogan's Heroes (runs up to 3) until midnight
    let hoganCount = 0;
    while (currentMs < nextDayMs && hoganCount < 3) {
      const hoganAsset = getNextAsset('hogans-heroes', currentMs);
      scheduleAsset(hoganAsset, currentMs);
      currentMs += Math.round(hoganAsset.durationSeconds * 1000);
      hoganCount++;
    }
  } else if (dayOfWeek === 6) { // Saturday
    // Saturday: 2 Western episodes, then prime alternating runs ending with Hogan's (max 3)
    for (let i = 0; i < 2; i++) {
      const show = westernShows[westernIdx % westernShows.length];
      westernIdx++;
      const asset = getNextAsset(show, currentMs);
      scheduleAsset(asset, currentMs);
      currentMs += Math.round(asset.durationSeconds * 1000);
    }
    // Prime runs of M*A*S*H and Taxi (2 episodes each) before closing Hogan's run
    for (let i = 0; i < 2; i++) {
      const asset = getNextAsset('mash', currentMs);
      scheduleAsset(asset, currentMs);
      currentMs += Math.round(asset.durationSeconds * 1000);
    }
    if ((nextDayMs - currentMs) > 85 * 60 * 1000) {
      for (let i = 0; i < 2; i++) {
        const asset = getNextAsset('taxi', currentMs);
        scheduleAsset(asset, currentMs);
        currentMs += Math.round(asset.durationSeconds * 1000);
      }
    }
    // Closing run of Hogan's Heroes (runs up to 3) ending at midnight
    let hoganCount = 0;
    while (currentMs < nextDayMs && hoganCount < 3) {
      const hoganAsset = getNextAsset('hogans-heroes', currentMs);
      scheduleAsset(hoganAsset, currentMs);
      currentMs += Math.round(hoganAsset.durationSeconds * 1000);
      hoganCount++;
    }
  } else {
    // Weeknight (Mon-Fri 18:00 - 24:00):
    // Alternating runs of M*A*S*H, Taxi (runs of 2), ending with Hogan's Heroes (max 3) before midnight.
    const weeknightShows = ['mash', 'taxi'];
    let wnIdx = 0;
    while (currentMs < nextDayMs) {
      const remainingMs = nextDayMs - currentMs;
      // When <= 85 min remain before midnight, enter Hogan's closing run
      if (remainingMs <= 85 * 60 * 1000) {
        let hoganCount = 0;
        while (currentMs < nextDayMs && hoganCount < 3) {
          const asset = getNextAsset('hogans-heroes', currentMs);
          scheduleAsset(asset, currentMs);
          currentMs += Math.round(asset.durationSeconds * 1000);
          hoganCount++;
        }
        break;
      }
      const show = weeknightShows[wnIdx % weeknightShows.length];
      wnIdx++;
      for (let i = 0; i < 2; i++) {
        if (currentMs >= nextDayMs) break;
        const asset = getNextAsset(show, currentMs);
        scheduleAsset(asset, currentMs);
        currentMs += Math.round(asset.durationSeconds * 1000);
      }
    }
  }
}

// Verification of results
const totalCartoonSec = cartoonPre1960Seconds + cartoonInEraSeconds;
const cartoonRatio = totalCartoonSec > 0 ? (cartoonPre1960Seconds / totalCartoonSec) : 0;

fs.mkdirSync('reports/classic-network', { recursive: true });
const previewFile = 'reports/classic-network/preview-schedule-14d.json';
fs.writeFileSync(previewFile, JSON.stringify({
  networkId: 'classic-network-draft',
  stationZone: zone,
  originMonday: config.originMonday,
  horizonDays: config.horizonDays,
  activeFrom: new Date(startMs).toISOString(),
  coveredUntilUtcMs: currentMs,
  programsCount: programs.length,
  cartoonStats: {
    pre1960Hours: cartoonPre1960Seconds / 3600,
    inEraHours: cartoonInEraSeconds / 3600,
    pre1960Ratio: cartoonRatio,
  },
  programs,
}, null, 2));

console.log(JSON.stringify({
  preview: previewFile,
  programs: programs.length,
  coveredUntil: new Date(currentMs).toISOString(),
  cartoonPre1960Ratio: cartoonRatio,
  fileSizeBytes: fs.statSync(previewFile).size,
}, null, 2));
