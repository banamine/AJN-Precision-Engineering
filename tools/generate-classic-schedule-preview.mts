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


const MIN = 60 * 1000;
const CLOSE_TOLERANCE_MS = 27 * MIN; // one episode: episodes are about 25 min, so the close lands 0 to 27 min after midnight without padding

interface Eligible { asset: NetworkAsset; idx: number }

/** Next assets of a show, in cursor order, that already satisfy the 168 h gate at `now`. */
function eligibleAssets(show: string, now: number, limit: number): Eligible[] {
  const list = byShow.get(show);
  if (!list || !list.length) throw new Error(`Empty catalog for show: ${show}`);
  const startIdx = cursors.get(show) ?? 0;
  const out: Eligible[] = [];
  for (let offset = 0; offset < list.length && out.length < limit; offset++) {
    const idx = (startIdx + offset) % list.length;
    const prev = lastStarts.get(list[idx].episodeKey);
    if (prev === undefined || (now - prev) >= gapMs) out.push({ asset: list[idx], idx });
  }
  return out;
}

function findHoganClose(remaining: number, pool: Eligible[], preferred: number): Eligible[] | null {
  if (remaining < 10 * MIN) return null;
  const sizes = [preferred, 3, 2, 1].filter((v, i, arr) => arr.indexOf(v) === i);
  for (const size of sizes) {
    const pick = (start: number, chosen: Eligible[]): Eligible[] | null => {
      if (chosen.length === size) {
        const total = chosen.reduce((sum, e) => sum + Math.round(e.asset.durationSeconds * 1000), 0);
        return total >= remaining && total - remaining <= CLOSE_TOLERANCE_MS ? chosen : null;
      }
      for (let i = start; i < pool.length; i++) {
        const found = pick(i + 1, [...chosen, pool[i]]);
        if (found) return found;
      }
      return null;
    };
    const chosen = pick(0, []);
    if (chosen) return chosen;
  }
  return null;
}

/**
 * Close the station day with a Hogan's Heroes run of 1-3 episodes whose total runtime ends
 * within 27 minutes after midnight. Returns false when no combination fits.
 */
function closeWithHogans(midnight: number, preferred: number): boolean {
  const pool = eligibleAssets('hogans-heroes', currentMs, 12);
  const chosen = findHoganClose(midnight - currentMs, pool, preferred);
  if (!chosen) return false;
  for (const e of chosen) {
    scheduleAsset(e.asset, currentMs);
    currentMs += Math.round(e.asset.durationSeconds * 1000);
  }
  cursors.set('hogans-heroes', (chosen[chosen.length - 1].idx + 1) % (byShow.get('hogans-heroes')!.length));
  return true;
}


interface PrimeStep { show: string; asset: NetworkAsset; idx: number }

function tailRun(): { show: string; count: number } {
  const last = programs[programs.length - 1];
  const show = String(last?.metadata?.show ?? '');
  let count = 0;
  for (let i = programs.length - 1; i >= 0 && String(programs[i].metadata?.show) === show; i--) count++;
  return { show, count };
}

/** Up to 4 M*A*S*H/Taxi episodes (run cap 3 respected) after which a Hogan's close fits within tolerance. */
function planPrimeBeforeClose(remaining: number, hoganPool: Eligible[], preferred: number, firstShow: string): PrimeStep[] | null {
  const shows = [firstShow, firstShow === 'mash' ? 'taxi' : 'mash'];
  const tail = tailRun();
  const search = (left: number, depth: number, prior: PrimeStep[], at: number): PrimeStep[] | null => {
    if (prior.length && findHoganClose(left, hoganPool, preferred)) return prior;
    if (depth === 0) return null;
    for (const show of shows) {
      const lastShow = prior.length ? prior[prior.length - 1].show : tail.show;
      const run = prior.length ? prior.filter(p => p.show === show).length + (tail.show === show ? tail.count : 0) : (tail.show === show ? tail.count : 0);
      if (show === lastShow && run >= 3) continue;
      for (const cand of eligibleAssets(show, at, 6)) {
        if (prior.some(p => p.asset.episodeKey === cand.asset.episodeKey)) continue;
        const dur = Math.round(cand.asset.durationSeconds * 1000);
        if (left - dur < 10 * MIN) continue;
        const found = search(left - dur, depth - 1, [...prior, { show, asset: cand.asset, idx: cand.idx }], at + dur);
        if (found) return found;
      }
    }
    return null;
  };
  for (let depth = 0; depth <= 4; depth++) {
    const found = search(remaining, depth, [], currentMs);
    if (found) return found;
  }
  return null;
}

/**
 * Evening prime: alternating M*A*S*H / Taxi runs of 1-3 (length from the date, never the same
 * series back to back across runs), then a closing Hogan's Heroes run that ends at midnight.
 */
function fillPrimeToMidnight(dayStr: string, dayIndex: number, midnight: number): void {
  const prime = ['mash', 'taxi'];
  let primeIdx = dayIndex % 2;
  let runIdx = 0;
  const playPrime = (show: string): void => {
    const asset = getNextAsset(show, currentMs);
    scheduleAsset(asset, currentMs);
    currentMs += Math.round(asset.durationSeconds * 1000);
  };
  for (let guard = 0; guard < 60; guard++) {
    const remaining = midnight - currentMs;
    if (remaining <= 170 * MIN) {
      if (closeWithHogans(midnight, 1 + ((dayIndex + 1) % 3))) return;
      if (remaining <= 30 * MIN) throw new Error(`Cannot close ${dayStr} with Hogan's Heroes within 27 minutes after midnight (remaining ${Math.round(remaining / MIN)} min)`);
      // No Hogan's combination fits yet: search up to 4 prime episodes that leave a fitting Hogan's close.
      const hoganPool = eligibleAssets('hogans-heroes', currentMs, 14);
      const preferred = 1 + ((dayIndex + 1) % 3);
      const plan = planPrimeBeforeClose(remaining, hoganPool, preferred, prime[primeIdx % prime.length]);
      if (!plan) throw new Error(`Cannot close ${dayStr} with Hogan's Heroes within 27 minutes after midnight (remaining ${Math.round(remaining / MIN)} min)`);
      for (const step of plan) {
        scheduleAsset(step.asset, currentMs);
        currentMs += Math.round(step.asset.durationSeconds * 1000);
        cursors.set(step.show, (step.idx + 1) % byShow.get(step.show)!.length);
        primeIdx++;
      }
      continue;
    }
    const show = prime[primeIdx++ % prime.length];
    const runLength = 1 + ((dayIndex + runIdx++) % 3);
    for (let i = 0; i < runLength && midnight - currentMs > 170 * MIN; i++) playPrime(show);
  }
  throw new Error(`Evening fill did not converge for ${dayStr}`);
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
    // Sunday: 2 Mystery Wheel episodes, 2 Westerns, then prime runs closing with Hogan's at midnight
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
  } else if (dayOfWeek === 6) {
    // Saturday: 2 Westerns, then prime runs closing with Hogan's at midnight
    for (let i = 0; i < 2; i++) {
      const show = westernShows[westernIdx % westernShows.length];
      westernIdx++;
      const asset = getNextAsset(show, currentMs);
      scheduleAsset(asset, currentMs);
      currentMs += Math.round(asset.durationSeconds * 1000);
    }
  }
  // Every night (weeknights, Saturday, Sunday): M*A*S*H/Taxi runs of 1-3, then Hogan's close at midnight.
  fillPrimeToMidnight(dayStr, dayOffset, nextDayMs);
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
