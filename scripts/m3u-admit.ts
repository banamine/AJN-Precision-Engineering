#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Status = 'LIVE' | 'DOWN' | 'ERROR';
type Counters = { admitted: number; droppedDead: number; droppedDup: number; droppedNonmedia: number; needsProxy: number };
type PlaylistSummary = Counters & { folder: string; file: string; total: number };
type Detail = { folder:string; file:string; line:number; url:string; canonicalUrl:string; disposition:string; needsProxy:boolean; reason:string };

const PRIORITY = ['Classic TV', 'Movies', 'TV', 'Mixed', 'Music'];
const DIRECT_MEDIA = /\.(mp4|m4v|webm|m3u8)(?:[?#].*)?$/i;
const PROXY_MEDIA = /\.(mkv|avi)(?:[?#].*)?$/i;
const NON_MEDIA = /\.(jpg|jpeg|png|gif|webp|srt|vtt|gz|xml|m3u|txt)(?:[?#].*)?$/i;
function arg(name:string, fallback?:string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}

const playlistArg = arg('--playlist');
const rootArg = arg('--root');
const statusArg = arg('--status');

if (!statusArg || (!playlistArg && !rootArg)) {
  console.error('Usage: m3u-admit.ts --playlist <file> --status <m3u-status.csv> [--out-dir ...] [--report ...]');
  console.error('   or: m3u-admit.ts --root <organizer-output> --status <m3u-status.csv> ...');
  process.exit(2);
}

const root = path.resolve(rootArg || path.dirname(path.resolve(playlistArg!)));
const statusPath = path.resolve(statusArg!);
const outDir = path.resolve(arg('--out-dir', 'm3u-admitted'));
const reportPath = path.resolve(arg('--report', 'reports/m3u-admit-report.csv'));

function csvCells(line:string):string[] {
  const out:string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(text:string):Record<string,string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = csvCells(lines[0]);
  return lines.slice(1).map(line =>
    Object.fromEntries(csvCells(line).map((value, i) => [headers[i] ?? `column${i}`, value]))
  );
}

function csvCell(value:unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function canonicalize(raw:string) {
  try {
    const url = new URL(raw.trim());
    if (/^ia\d+\.us\.archive\.org$/i.test(url.hostname) && /^\/\d+\/items\//.test(url.pathname)) {
      const parts = url.pathname.split('/');
      return `https://archive.org/download/${parts[3]}/${parts.slice(4).join('/')}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function isNonMedia(url:string) {
  return NON_MEDIA.test(url);
}

function isMedia(url:string) {
  return DIRECT_MEDIA.test(url) || PROXY_MEDIA.test(url);
}

function needsProxy(url:string) {
  return PROXY_MEDIA.test(url);
}

function folderFor(file:string) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  return relative.split('/')[0] || 'Unknown';
}

async function walk(dir:string):Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files:string[] = [];
  for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (path.resolve(full) === outDir) continue;
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && /\.m3u8?$/i.test(entry.name)) files.push(full);
  }
  return files;
}

const statuses = new Map<string,Status>();
for (const row of parseCsv(await readFile(statusPath, 'utf8'))) {
  if (row.url?.trim()) statuses.set(canonicalize(row.url), row.status as Status);
}

const files = (playlistArg ? [path.resolve(playlistArg)] : await walk(root)).sort((a,b) => {
  const aPriority = PRIORITY.indexOf(folderFor(a));
  const bPriority = PRIORITY.indexOf(folderFor(b));
  return (aPriority < 0 ? 99 : aPriority) - (bPriority < 0 ? 99 : bPriority) || a.localeCompare(b);
});

const seen = new Map<string,string>();
const details:Detail[] = [];
const summaries:PlaylistSummary[] = [];
const totals:Counters = { admitted:0, droppedDead:0, droppedDup:0, droppedNonmedia:0, needsProxy:0 };

await mkdir(outDir, { recursive: true });

for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const folder = folderFor(file);
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
  const output:string[] = [];
  const playlistHeader = lines.find(line => /^#PLAYLIST:/i.test(line));
  output.push(playlistHeader?.trim() || `#PLAYLIST: ${path.basename(file).replace(/\.m3u8?$/i, '')}`);
  let extinf = '';

  const summary:PlaylistSummary = {
    folder, file: relative, total:0, admitted:0, droppedDead:0, droppedDup:0, droppedNonmedia:0, needsProxy:0
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) { extinf = line; continue; }
    if (line.startsWith('#')) continue;

    const url = line;
    summary.total++;
    const canonicalUrl = canonicalize(url);
    const proxy = needsProxy(canonicalUrl);
    let disposition:string;
    let reason:string;

    if (isNonMedia(canonicalUrl) || !isMedia(canonicalUrl)) {
      disposition = 'dropped-nonmedia';
      reason = 'non-media or unsupported extension';
      summary.droppedNonmedia++;
    } else if (statuses.get(canonicalUrl) !== 'LIVE') {
      const status = statuses.get(canonicalUrl);
      disposition = 'dropped-dead';
      reason = status ? `${status} in latest status CSV` : 'no LIVE status in latest status CSV';
      summary.droppedDead++;
    } else if (seen.has(canonicalUrl)) {
      disposition = 'dropped-dup';
      reason = `canonical URL already admitted by ${seen.get(canonicalUrl)}`;
      summary.droppedDup++;
    } else {
      disposition = 'admitted';
      reason = 'LIVE';
      seen.set(canonicalUrl, relative);
      summary.admitted++;
      if (proxy) summary.needsProxy++;
      if (extinf) output.push(extinf);
      output.push(canonicalUrl);
    }

    details.push({
      folder, file:relative, line:i + 1, url, canonicalUrl, disposition, needsProxy:proxy, reason
    });
    extinf = '';
  }

  summaries.push(summary);
  totals.admitted += summary.admitted;
  totals.droppedDead += summary.droppedDead;
  totals.droppedDup += summary.droppedDup;
  totals.droppedNonmedia += summary.droppedNonmedia;
  totals.needsProxy += summary.needsProxy;

  if (summary.admitted > 0) {
    const destination = path.join(outDir, relative);
    await mkdir(path.dirname(destination), { recursive:true });
    await writeFile(destination, output.join('\n') + '\n');
  }
}

await mkdir(path.dirname(reportPath), { recursive:true });

const summaryFields = ['folder','file','total','admitted','dropped-dead','dropped-dup','dropped-nonmedia','needsProxy','statusBasis'];
const summaryRows = summaries.map(summary => [
  summary.folder, summary.file, summary.total, summary.admitted, summary.droppedDead,
  summary.droppedDup, summary.droppedNonmedia, summary.needsProxy, 'probe=original; admission=canonical'
]);
const grandTotal = [
  'TOTAL', '', summaryRows.reduce((n,row) => n + Number(row[2]), 0),
  totals.admitted, totals.droppedDead, totals.droppedDup, totals.droppedNonmedia, totals.needsProxy,
  'probe=original; admission=canonical'
];

await writeFile(
  reportPath,
  [summaryFields.join(','), ...summaryRows, grandTotal]
    .map(row => Array.isArray(row) ? row.map(csvCell).join(',') : row)
    .join('\n') + '\n'
);

const detailPath = reportPath.replace(/\.csv$/i, '-details.csv');
const detailFields = ['folder','file','line','url','canonicalUrl','disposition','needsProxy','reason','statusProbeUrl'];
await writeFile(
  detailPath,
  [detailFields.join(','), ...details.map(row => detailFields.map(field => csvCell(row[field as keyof Detail])).join(','))]
    .join('\n') + '\n'
);

console.log(JSON.stringify({
  playlists: files.length,
  statusRows: statuses.size,
  totals,
  report: reportPath,
  details: detailPath
}, null, 2));
