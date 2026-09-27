// Layer 0 — Local Files. No network. Identity = relative path + size + mtime hash.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Program } from '../../src/types';
import type { SourceContract, RejectedItem } from './contract';
import { statusFrom } from './contract';

export interface LocalFilesInput {
  /** Absolute folder to scan. Empty or missing folder = source offline, not an error elsewhere. */
  root: string;
  guideId: string;
  maxFiles?: number;
}

const VIDEO = new Set(['.mp4', '.m4v', '.webm']);
const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.ogg']);
const UNSUPPORTED_VIDEO = new Set(['.mkv', '.avi', '.mov', '.wmv', '.mpg', '.mpeg', '.ts']);

async function walk(dir: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (out.length >= limit) return;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out, limit);
    else if (entry.isFile()) out.push(full);
  }
}

export const localFilesContract: SourceContract<LocalFilesInput> = {
  sourceClass: 'local_file',
  priority: 0,
  async hook(input, ctx) {
    const programs: Program[] = [];
    const rejected: RejectedItem[] = [];
    const base = {
      sourceClass: 'local_file' as const,
      fetchedAt: ctx.now.toISOString(),
    };

    try {
      const stat = await fs.stat(input.root);
      if (!stat.isDirectory()) throw new Error('not a directory');
    } catch (err: any) {
      return { ...base, status: 'offline', programs, rejected, error: `local media folder unavailable: ${err?.message}` };
    }

    const files: string[] = [];
    await walk(input.root, files, input.maxFiles ?? 5000);

    for (const full of files) {
      const rel = path.relative(input.root, full).split(path.sep).join('/');
      const ext = path.extname(full).toLowerCase();
      const isVideo = VIDEO.has(ext);
      const isAudio = AUDIO.has(ext);
      if (!isVideo && !isAudio) {
        if (UNSUPPORTED_VIDEO.has(ext)) rejected.push({ id: rel, reason: `${ext} is not browser-playable` });
        continue;
      }
      const st = await fs.stat(full);
      const hash = crypto.createHash('sha256').update(`${rel}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20);
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : 'Local';
      programs.push({
        id: `program_local_${hash}`,
        guideId: input.guideId,
        channelId: `local:${folder.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        title: path.basename(full, ext),
        startTime: 0,
        endTime: 0,
        mediaType: isAudio ? 'audio' : 'video',
        mediaUrl: `/api/local/media/${rel.split('/').map(encodeURIComponent).join('/')}`,
        assetId: `asset_local_${hash}`,
        sourceId: 'source_local_files',
        metadata: { externalId: `local:${rel}`, relativePath: rel, sizeBytes: st.size },
      });
    }

    return { ...base, status: statusFrom(programs.length, rejected.length), programs, rejected };
  },
};
