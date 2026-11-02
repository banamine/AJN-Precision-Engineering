#!/usr/bin/env node
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPacedArchiveFetch } from './newsSnapshotPacer.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(repoRoot, 'src/data/newsSnapshot.json');
const startedAt = Date.now();
const fetchImpl = createPacedArchiveFetch();

try {
  const [{ refreshCableNews, exportNewsSnapshot }, { validateNewsSnapshot }] = await Promise.all([
    import('../guideRegistry.ts'),
    import('../server/newsSnapshot.ts'),
  ]);

  // This is a manual-only command. It uses the same Archive News search and
  // metadata code as the app, while forcing metadata requests to remain serial.
  const refreshResults = await refreshCableNews('cable-tv', fetchImpl, { metadataConcurrency: 1 });
  const hasFreshChannelData = refreshResults.some((result) =>
    result.outcome === 'ok' && result.dataFetchedAt && Date.parse(result.dataFetchedAt) >= startedAt,
  );
  if (!hasFreshChannelData) {
    throw new Error('No channel returned fresh playable items; existing snapshot was not changed.');
  }
  const snapshot = validateNewsSnapshot(exportNewsSnapshot());
  if (!snapshot) throw new Error('Refresh produced no valid playable News snapshot; existing file was not changed.');

  await mkdir(dirname(destination), { recursive: true });
  const tempPath = `${destination}.tmp-${process.pid}`;
  await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
  await rename(tempPath, destination);

  console.log(JSON.stringify({
    outcome: 'written',
    path: 'src/data/newsSnapshot.json',
    fetchedAt: snapshot.fetchedAt,
    channels: snapshot.channels.length,
    programs: snapshot.channels.reduce((count, channel) => count + channel.programs.length, 0),
    physicalRequestStarts: fetchImpl.stats().starts,
    elapsedMs: Date.now() - startedAt,
    minimumGapMs: 1_500,
  }));
} catch (error) {
  console.error(`[news snapshot refresh] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
