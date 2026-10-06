import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(path.join(os.tmpdir(), 'ajn-m3u-admit-'));
try {
  const classic = path.join(root, 'Classic TV');
  const movies = path.join(root, 'Movies');
  const tv = path.join(root, 'TV');
  await Promise.all([mkdir(classic), mkdir(movies), mkdir(tv)]);

  const pinned = 'https://ia600503.us.archive.org/27/items/ID/Folder/clip.avi';
  const live = 'https://archive.org/download/ID/Folder/live.mp4';
  const shared = 'https://archive.org/download/ID/Folder/shared.mp4';
  const down = 'https://archive.org/download/ID/Folder/down.mp4';
  const image = 'https://archive.org/download/ID/Folder/poster.jpg';

  await writeFile(path.join(classic, 'one.m3u'),
    ['#EXTM3U', '#EXTINF:-1,Live', live, '#EXTINF:-1,Down', down,
      '#EXTINF:-1,Poster', image, '#EXTINF:-1,Proxy', pinned,
      '#EXTINF:-1,Shared', shared].join('\n') + '\n');
  await writeFile(path.join(movies, 'two.m3u'),
    ['#EXTM3U', '#EXTINF:-1,Shared again', shared].join('\n') + '\n');
  await writeFile(path.join(tv, 'three.m3u'),
    ['#EXTM3U', '#EXTINF:-1,Live again', live].join('\n') + '\n');

  const statusPath = path.join(root, 'm3u-status.csv');
  const q = (v:string) => `"${v.replaceAll('"', '""')}"`;
  const status = [
    'file,line,status,httpStatus,attempts,elapsedMs,error,url,checkedAt',
    [path.join('Classic TV', 'one.m3u'), 3, 'LIVE', 200, 1, 1, '', live, '2026-10-06T00:00:00Z'].map(q).join(','),
    [path.join('Classic TV', 'one.m3u'), 5, 'DOWN', 404, 1, 1, 'HTTP 404', down, '2026-10-06T00:00:00Z'].map(q).join(','),
    [path.join('Classic TV', 'one.m3u'), 7, 'LIVE', 200, 1, 1, '', image, '2026-10-06T00:00:00Z'].map(q).join(','),
    [path.join('Classic TV', 'one.m3u'), 9, 'LIVE', 200, 1, 1, '', 'https://ia600503.us.archive.org/27/items/ID/Folder/clip.avi', '2026-10-06T00:00:00Z'].map(q).join(','),
    [path.join('Classic TV', 'one.m3u'), 11, 'LIVE', 200, 1, 1, '', shared, '2026-10-06T00:00:00Z'].map(q).join(','),
  ].join('\n') + '\n';
  await writeFile(statusPath, status);

  const outDir = path.join(root, 'admitted');
  const report = path.join(root, 'report.csv');
  const proc = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/m3u-admit.ts',
    '--root', root, '--status', statusPath, '--out-dir', outDir, '--report', report],
    { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);

  const admitted = await readFile(path.join(outDir, 'Classic TV', 'one.m3u'), 'utf8');
  assert.match(admitted, new RegExp(live.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(admitted, /https:\/\/archive\.org\/download\/ID\/Folder\/clip\.avi/);
  assert.doesNotMatch(admitted, /down\.mp4|poster\.jpg/);
  assert.equal((admitted.match(/#EXTINF:/g) || []).length, 3);
  assert.equal((await readFile(path.join(outDir, 'Movies', 'two.m3u'), 'utf8').catch(() => '')), '');
  assert.equal((await readFile(path.join(outDir, 'TV', 'three.m3u'), 'utf8').catch(() => '')), '');

  const rows = (await readFile(report, 'utf8')).trim().split(/\r?\n/).map(line => line.split(','));
  const header = rows[0];
  const total = rows.at(-1)!;
  const ix = (name:string) => header.indexOf(`"${name}"`) >= 0 ? header.indexOf(`"${name}"`) : header.indexOf(name);
  assert.equal(total[ix('file')], '""');
  assert.equal(total[ix('total')], '"7"');
  assert.equal(total[ix('admitted')], '"2"');
  assert.equal(total[ix('dropped-dead')], '"1"');
  assert.equal(total[ix('dropped-dup')], '"2"');
  assert.equal(total[ix('dropped-nonmedia')], '"2"');
  assert.equal(total[ix('statusBasis')], '"probe=original; admission=canonical"');
  assert.ok((await readFile(report, 'utf8')).includes('needsProxy'));

  console.log('m3u admission regression: all passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
