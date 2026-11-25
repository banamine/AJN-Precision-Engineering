import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Program } from '../src/types';
import { zonedParts, dateKey, HOUR, addDays, localInstant, compileNetwork } from '../server/classicNetwork';
import type { NetworkCatalog, NetworkSettings } from '../server/classicNetwork';

interface PreviewManifest {
  networkId: string;
  stationZone: string;
  originMonday: string;
  horizonDays: number;
  programsCount: number;
  cartoonStats: {
    pre1960Hours: number;
    inEraHours: number;
    pre1960Ratio: number;
  };
  programs: Program[];
}

const previewPath = 'reports/classic-network/preview-schedule-14d.json';
assert.ok(fs.existsSync(previewPath), `Preview manifest must exist at ${previewPath}`);

const manifest = JSON.parse(fs.readFileSync(previewPath, 'utf8')) as PreviewManifest;
const programs = manifest.programs;
const zone = manifest.stationZone;

console.log(`Auditing 14-day preview schedule: ${programs.length} programs in ${zone}...`);

// 1. Basic integrity & runtime
let positiveRuntimes = 0;
for (const p of programs) {
  const dur = Number(p.metadata?.durationSeconds);
  assert.ok(Number.isFinite(dur) && dur > 0, `Program ${p.id} must have real durationSeconds > 0`);
  assert.ok(typeof p.archivePath === 'string' && p.archivePath.length > 0, `Program ${p.id} must have archivePath`);
  assert.equal(p.isArchivedSource, true);
  positiveRuntimes++;
}
assert.equal(positiveRuntimes, programs.length, 'All programs have verified positive duration');

// 2. Zero blacklisted occurrences
const blacklistedShows = new Set([
  'danger-man',
  'the-saint',
  'maigret',
  'granada-sherlock-holmes',
  'soap',
  'all-my-children',
  'allmychildren',
  'voyager',
  'star-trek-voyager',
  'x-men',
  'gargoyles',
  'reboot',
  'spider-man',
  'beavis-and-butt-head',
  'teknoman',
  'burns-and-allen',
]);

for (const p of programs) {
  const show = String(p.metadata?.show ?? '').toLowerCase();
  const title = String(p.title ?? '').toLowerCase();
  const pathStr = String(p.archivePath ?? '').toLowerCase();
  for (const b of blacklistedShows) {
    assert.ok(!show.includes(b), `Blacklisted show ${b} must not appear in schedule (found in ${p.id})`);
    assert.ok(!pathStr.includes(b), `Blacklisted source ${b} must not appear in archivePath (${pathStr})`);
  }
}
console.log('✓ Blacklist audit passed: 0 blacklisted shows or crossovers found');

// 3. 168-hour repeat gate compliance
const gapMs = 168 * HOUR;
const lastStarts = new Map<string, number>();
for (const p of programs) {
  const key = String(p.metadata?.episodeKey);
  const startMs = Date.parse(p.startTimeUtc!);
  const prev = lastStarts.get(key);
  if (prev !== undefined) {
    const elapsed = startMs - prev;
    assert.ok(elapsed >= gapMs, `Repeat gate violated for ${key}: ${elapsed}ms < 168h (${gapMs}ms)`);
  }
  lastStarts.set(key, startMs);
}
console.log('✓ 168-hour repeat gate passed: all episode repeats spaced >= 7 days');

// 4. Never 5 in a row of any show anywhere
let consecutiveCount = 1;
let lastShow = '';
for (const p of programs) {
  const currentShow = String(p.metadata?.show);
  if (currentShow === lastShow) {
    consecutiveCount++;
    assert.ok(consecutiveCount < 5, `Never 5 in a row violated for show ${currentShow}: reached ${consecutiveCount}`);
  } else {
    consecutiveCount = 1;
    lastShow = currentShow;
  }
}
console.log('✓ Run cap passed: no show airs 5 times in a row anywhere');

// 5. Weeknight prime runs (1-3 episodes alternating, ending with Hogan's before midnight)
// Group programs by station day
const byDay = new Map<string, Program[]>();
for (const p of programs) {
  const startMs = Date.parse(p.startTimeUtc!);
  const day = dateKey(startMs, zone);
  const list = byDay.get(day) ?? [];
  list.push(p);
  byDay.set(day, list);
}

for (const [day, dayPrograms] of byDay.entries()) {
  const dayDate = new Date(`${day}T12:00:00Z`);
  const dayOfWeek = dayDate.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const isWeeknight = (dayOfWeek >= 1 && dayOfWeek <= 5);

  if (isWeeknight) {
    // Check prime window (18:00 - 24:00)
    const primePrograms = dayPrograms.filter(p => {
      const parts = zonedParts(Date.parse(p.startTimeUtc!), zone);
      return parts.hour >= 18;
    });

    assert.ok(primePrograms.length > 0, `Weeknight ${day} must have prime programs`);

    // Verify runs of up to 3 episodes
    let runCount = 0;
    let runShow = '';
    for (const p of primePrograms) {
      const show = String(p.metadata?.show);
      if (show === runShow) {
        runCount++;
        assert.ok(runCount <= 3, `Weeknight prime run for ${show} on ${day} must not exceed 3 episodes (was ${runCount})`);
      } else {
        runCount = 1;
        runShow = show;
      }
    }

    // The LAST program of the evening must be Hogan's Heroes
    const lastProgram = primePrograms[primePrograms.length - 1];
    assert.equal(lastProgram.metadata?.show, 'hogans-heroes', `Weeknight ${day} must end with Hogan's Heroes before midnight`);
  }
}
console.log('✓ Weeknight prime passed: runs capped at 3, series alternate, ends with Hogan\'s');

// 6. Weekday daytime singularity (06:00 - 18:00, strictly single episodes)
for (const [day, dayPrograms] of byDay.entries()) {
  const dayDate = new Date(`${day}T12:00:00Z`);
  const dayOfWeek = dayDate.getUTCDay();
  const isWeekday = (dayOfWeek >= 1 && dayOfWeek <= 5);

  if (isWeekday) {
    const daytimePrograms = dayPrograms.filter(p => {
      const parts = zonedParts(Date.parse(p.startTimeUtc!), zone);
      return parts.hour >= 6 && parts.hour < 18;
    });

    let prevShow = '';
    for (const p of daytimePrograms) {
      const show = String(p.metadata?.show);
      assert.notEqual(show, prevShow, `Weekday daytime on ${day} must be single episodes only; found repeated show ${show}`);
      prevShow = show;
    }
  }
}
console.log('✓ Weekday daytime passed: all daytime airings are single episodes rotating across shows');

// 7. Weekend morning cartoon airtime ratio (60% ± 5% pre-1960)
const draftPools = (JSON.parse(fs.readFileSync('config/classic-network-draft.json', 'utf8')) as { pools: Record<string, { series: string[] }> }).pools;
const pre1960Shows = new Set(draftPools['cartoons-pre1960'].series);
const inEraShows = new Set(draftPools['cartoons-inera'].series);

let totalPre1960Sec = 0;
let totalInEraSec = 0;

for (const [day, dayPrograms] of byDay.entries()) {
  const dayDate = new Date(`${day}T12:00:00Z`);
  const dayOfWeek = dayDate.getUTCDay();
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

  if (isWeekend) {
    const morningPrograms = dayPrograms.filter(p => {
      const parts = zonedParts(Date.parse(p.startTimeUtc!), zone);
      return parts.hour >= 6 && parts.hour < 12;
    });

    for (const p of morningPrograms) {
      const show = String(p.metadata?.show);
      const dur = Number(p.metadata?.durationSeconds);
      if (pre1960Shows.has(show)) totalPre1960Sec += dur;
      else if (inEraShows.has(show)) totalInEraSec += dur;
    }
  }
}

const totalCartoonSec = totalPre1960Sec + totalInEraSec;
const pre1960Ratio = totalPre1960Sec / totalCartoonSec;
console.log(`Cartoon airtime ratio: ${(pre1960Ratio * 100).toFixed(2)}% pre-1960 (${(totalPre1960Sec / 3600).toFixed(1)}h / ${(totalCartoonSec / 3600).toFixed(1)}h)`);
assert.ok(pre1960Ratio >= 0.55 && pre1960Ratio <= 0.65, `Pre-1960 cartoon airtime ratio must be 60% ± 5% (actual: ${(pre1960Ratio * 100).toFixed(2)}%)`);
console.log('✓ Weekend cartoon airtime ratio passed: strictly within 60% ± 5%');

// 8. Westerns & Mystery Wheel daypart bounds
const westernShows = new Set(['wanted-dead-or-alive', 'the-loner', 'hondo', 'death-valley-days']);
const mysteryShows = new Set(['sherlock-holmes-1954', 'ironside', 'colonel-march', 'murder-she-wrote']); // colonel-march kept so a stray airing is still bounded

for (const p of programs) {
  const show = String(p.metadata?.show);
  const startMs = Date.parse(p.startTimeUtc!);
  const parts = zonedParts(startMs, zone);
  const dayDate = new Date(`${dateKey(startMs, zone)}T12:00:00Z`);
  const dayOfWeek = dayDate.getUTCDay();

  if (westernShows.has(show)) {
    // Westerns only on weekend evenings
    assert.ok(dayOfWeek === 0 || dayOfWeek === 6, `Western ${show} must air only on weekends (found on day ${dayOfWeek})`);
    assert.ok(parts.hour >= 18 && parts.hour < 24, `Western ${show} must air only in evening (found at hour ${parts.hour})`);
  }

  if (mysteryShows.has(show)) {
    // Mystery wheel only on Sunday evenings
    assert.equal(dayOfWeek, 0, `Sunday mystery show ${show} must air only on Sundays (found on day ${dayOfWeek})`);
    assert.ok(parts.hour >= 18 && parts.hour < 24, `Sunday mystery show ${show} must air in evening (found at hour ${parts.hour})`);
  }
}
console.log('✓ Daypart segregation passed: Westerns on weekend evenings only, Mystery on Sunday evenings only');


// 9. Every night (Mon-Sun) closes with Hogan's Heroes within ~half an episode of midnight, runs capped at 3
const MIDNIGHT_TOLERANCE_MS = 27 * 60 * 1000;
assert.equal(byDay.size, 14, `Preview must cover 14 station days (found ${byDay.size})`);
for (const [day, dayPrograms] of byDay.entries()) {
  const evening = dayPrograms.filter(p => zonedParts(Date.parse(p.startTimeUtc!), zone).hour >= 18);
  assert.ok(evening.length > 0, `${day} must have evening programs`);
  const last = evening[evening.length - 1];
  assert.equal(last.metadata?.show, 'hogans-heroes', `${day} must end with Hogan's Heroes (found ${String(last.metadata?.show)})`);
  const midnight = localInstant(addDays(day, 1), '00:00', zone);
  const endMs = Date.parse(last.endTimeUtc!);
  assert.ok(endMs >= midnight && endMs - midnight <= MIDNIGHT_TOLERANCE_MS, `${day} must end 0 to 27 min after midnight (off by ${Math.round((endMs - midnight) / 60000)} min)`);
  let run = 0; let runShow = '';
  for (const p of evening) {
    const show = String(p.metadata?.show);
    run = show === runShow ? run + 1 : 1; runShow = show;
    assert.ok(run <= 3, `${day} evening run of ${show} exceeds 3`);
  }
}
const lastProgram = programs[programs.length - 1];
const horizonEnd = localInstant(addDays(manifest.originMonday, manifest.horizonDays), '00:00', zone);
assert.ok(Date.parse(lastProgram.endTimeUtc!) - horizonEnd >= 0 && Date.parse(lastProgram.endTimeUtc!) - horizonEnd <= MIDNIGHT_TOLERANCE_MS, 'Preview must cover the full 14 days');
console.log('✓ Every night passed: Hogan\'s closes 0 to 27 min after midnight, runs capped at 3, 14 days covered');

// 10. Every pool series exists in the catalog; the live config compiles
const catalog = JSON.parse(fs.readFileSync('src/data/classicNetworkCatalog.json', 'utf8')) as NetworkCatalog;
const catalogShows = new Set(catalog.assets.map(a => a.show));
const draft = JSON.parse(fs.readFileSync('config/classic-network-draft.json', 'utf8')) as { pools: Record<string, { series: string[] }> };
for (const [poolName, pool] of Object.entries(draft.pools)) {
  for (const show of pool.series) assert.ok(catalogShows.has(show), `Draft pool ${poolName} uses "${show}", which is not in the catalog`);
}
const liveSettings = JSON.parse(fs.readFileSync('config/classic-networks.json', 'utf8')) as NetworkSettings;
const liveNetwork = liveSettings.networks['classic-network'];
for (const [poolName, pool] of Object.entries(liveNetwork.pools)) {
  for (const show of pool.series) assert.ok(catalogShows.has(show), `Live pool ${poolName} uses "${show}", which is not in the catalog`);
}
const compiled = compileNetwork(liveSettings, liveNetwork, catalog);
assert.ok(compiled.programs.length > 0, 'Live classic-network config must compile to a non-empty publication');
for (const banned of ['danger-man', 'colonel-march']) {
  assert.ok(!JSON.stringify(draft).includes(banned) && !JSON.stringify(liveNetwork).includes(banned), `${banned} must not be configured`);
}
assert.ok(draft.pools['cartoons-pre1960'].series.includes('beary-family'), 'beary-family belongs in the pre-1960 pool');
console.log('✓ Config passed: all pool shows exist in the catalog and the live config compiles');

console.log('\n========================================');
console.log('CLASSIC_NETWORK_SCHEDULE_RULES_PASS (all 8 owner decisions validated)');
console.log('========================================');
