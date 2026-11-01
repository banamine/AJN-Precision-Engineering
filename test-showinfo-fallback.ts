import assert from 'node:assert/strict';
import { getScheduleForGuide } from './guideRegistry';
import { splitMoviesClassicsChannel, MOVIES_CLASSICS_LEGACY_CHANNEL_ID } from './server/moviesClassicsSchedule';
import { buildFallbackShowInfo } from './src/showinfo/fallback';

const FIXED_NOW = new Date('2026-10-31T12:00:00.000Z');
const titleKey = (title: unknown) => String(title ?? '')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();
const distinctTitleCount = (rows: Array<{ title: string }>) =>
  new Set(rows.map((row) => titleKey(row.title)).filter(Boolean)).size;
const distinctFileRows = (rows: Array<{ title: string; identifier: string; file: string }>) => {
  const unique = new Map<string, { title: string; identifier: string; file: string }>();
  for (const row of rows) {
    const fileKey = `${row.identifier}/${row.file.split('?')[0]}`;
    if (!unique.has(fileKey)) unique.set(fileKey, row);
  }
  return [...unique.values()];
};

async function main() {
  const manifestModule: any = await import('./src/data/extraChannelsManifest.json');
  const manifest = manifestModule.default ?? manifestModule;
  const legacy = manifest.channels.find((channel: any) => channel.id === MOVIES_CLASSICS_LEGACY_CHANNEL_ID);
  assert.ok(legacy, 'legacy Movies Classics manifest pool exists');

  const pools = new Map<string, Array<{ title: string; identifier: string; file: string }>>();
  const firstPartition = splitMoviesClassicsChannel(legacy)[0];
  pools.set(firstPartition.id, firstPartition.rows);
  for (const id of ['mx-aiviixx', 'mx-jt-s-ghost']) {
    const channel = manifest.channels.find((candidate: any) => candidate.id === id);
    assert.ok(channel, `source pool exists for ${id}`);
    pools.set(id, channel.rows);
  }

  // The fixed schedule clock makes the daily program slice deterministic without network access.
  const schedule = await getScheduleForGuide('movies-classics-vault', FIXED_NOW);
  const rows: Array<{ id: string; todayPrograms: number; todayDistinctTitles: number; poolDistinctTitles: number; distinctFiles: number }> = [];
  for (const [id, pool] of pools) {
    const channel = schedule.find((candidate) => candidate.id === id);
    assert.ok(channel, `scheduled channel exists for ${id}`);
    const uniqueFiles = distinctFileRows(pool);
    const expectedPoolTitles = distinctTitleCount(uniqueFiles);
    const expectedFiles = uniqueFiles.length;
    assert.equal(channel.rotationTitleCount, expectedPoolTitles, `${id} count matches its full unique-title pool`);

    const info = buildFallbackShowInfo(channel);
    const programText = `${channel.programs.length} program${channel.programs.length === 1 ? '' : 's'} today`;
    const rotationText = `${expectedPoolTitles} distinct title${expectedPoolTitles === 1 ? '' : 's'} in rotation`;
    assert.ok(info.facts.includes(`${programText} · ${rotationText}`), `${id} labels daily count separately from the full pool`);
    assert.ok(!info.facts.some((fact) => /Source:|Source status|Internet Archive|distinct titles today/i.test(fact)));
    rows.push({
      id,
      todayPrograms: channel.programs.length,
      todayDistinctTitles: distinctTitleCount(channel.programs),
      poolDistinctTitles: expectedPoolTitles,
      distinctFiles: expectedFiles,
    });
  }

  const news = buildFallbackShowInfo({
    id: 'fixture-news-channel',
    name: 'Synthetic News Channel',
    group: 'News',
    mediaType: 'video',
    sourceStatus: 'snapshot',
    programs: [{
      title: 'Evening News',
      metadata: { airedUtc: FIXED_NOW.toISOString() },
    }],
  });
  assert.ok(news.facts.includes('1 program today'), 'unknown News pool shows only its daily program count');
  assert.ok(!news.facts.some((fact) => /Source:|Source status|Internet Archive|distinct titles today/i.test(fact)));
  assert.equal('link' in news, false, 'fallback popover data has no outbound-link field');

  console.log(JSON.stringify({ fixedNow: FIXED_NOW.toISOString(), movies: rows, news: news.facts }, null, 2));
  console.log('[showinfo-fallback] PASS — injected schedule date, full-pool counts, daily counts, and source-free fallback data');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
