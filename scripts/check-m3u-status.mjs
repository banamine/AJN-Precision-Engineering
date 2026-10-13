#!/usr/bin/env node
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.M3U_ROOT || 'm3u_files');
const outDir = path.resolve(process.env.M3U_REPORT_DIR || 'm3u-status-report');
const timeoutMs = Number(process.env.M3U_TIMEOUT_MS || 30000);
const retries = Number(process.env.M3U_RETRIES || 2);
const concurrency = Math.max(1, Number(process.env.M3U_CONCURRENCY || 8));
const userAgent = 'AJN-M3U-Status-Check/1.0 (+https://github.com/banamine/AJN-Precision-Engineering)';

async function filesUnder(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.m3u') ? [full] : [];
  }));
  return nested.flat().sort((a, b) => a.localeCompare(b));
}

function playlistUrls(text) {
  return text.split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map((url, index) => ({ url, line: index + 1 }));
}

async function probe(url) {
  let last = { status: 'ERROR', httpStatus: '', error: 'No attempt made', attempts: 0, elapsedMs: 0 };
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      let response;
      try {
        response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal,
          headers: { 'user-agent': userAgent, 'accept': '*/*' } });
        if ([403, 405, 501].includes(response.status)) {
          await response.body?.cancel().catch(() => {});
          response = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal,
            headers: { 'user-agent': userAgent, 'accept': '*/*', 'range': 'bytes=0-0' } });
        }
      } finally { clearTimeout(timer); }
      const elapsedMs = Date.now() - started;
      const httpStatus = response.status;
      const reachable = httpStatus >= 200 && httpStatus < 400;
      const error = reachable ? '' : `HTTP ${httpStatus}${response.statusText ? ` ${response.statusText}` : ''}`;
      await response.body?.cancel().catch(() => {});
      last = { status: reachable ? 'LIVE' : 'DOWN', httpStatus, error, attempts: attempt, elapsedMs };
      if (reachable || attempt > retries) return last;
    } catch (e) {
      clearTimeout(timer);
      last = { status: 'ERROR', httpStatus: '', error: e.name === 'AbortError' ? `Timeout after ${timeoutMs} ms` : String(e.message || e), attempts: attempt, elapsedMs: Date.now() - started };
      if (attempt > retries) return last;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempt, 5000)));
  }
  return last;
}

const playlistFiles = await filesUnder(root);
if (!playlistFiles.length) { console.error(`No .m3u files found under ${root}`); process.exit(2); }
const tasks = [];
for (const file of playlistFiles) {
  const text = await readFile(file, 'utf8');
  for (const entry of playlistUrls(text)) tasks.push({ file: path.relative(process.cwd(), file).replaceAll('\\', '/'), ...entry });
}
if (!tasks.length) { console.error(`Found ${playlistFiles.length} playlist(s), but no URL entries`); process.exit(2); }

console.log(`Checking ${tasks.length} URLs from ${playlistFiles.length} playlist(s); concurrency=${concurrency}, timeout=${timeoutMs}ms, retries=${retries}`);
const results = new Array(tasks.length);
let next = 0;
let done = 0;
async function worker() {
  while (true) {
    const index = next++;
    if (index >= tasks.length) return;
    const item = tasks[index];
    results[index] = { ...item, ...(await probe(item.url)), checkedAt: new Date().toISOString() };
    done++;
    if (done % 25 === 0 || done === tasks.length) console.log(`Progress: ${done}/${tasks.length}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));

await mkdir(outDir, { recursive: true });
const csvFields = ['file', 'line', 'status', 'httpStatus', 'attempts', 'elapsedMs', 'error', 'url', 'checkedAt'];
const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csv = [csvFields.join(','), ...results.map(row => csvFields.map(field => csvCell(row[field])).join(','))].join('\n') + '\n';
await writeFile(path.join(outDir, 'm3u-status.csv'), csv);

const live = results.filter(r => r.status === 'LIVE').length;
const down = results.filter(r => r.status === 'DOWN').length;
const errors = results.filter(r => r.status === 'ERROR').length;
const byFile = new Map();
for (const row of results) {
  const group = byFile.get(row.file) || { total: 0, live: 0, down: 0, error: 0 };
  group.total++; group[row.status.toLowerCase()]++; byFile.set(row.file, group);
}
const markdown = [
  '# M3U live status report', '', `Checked: ${new Date().toISOString()}`,
  `Playlists: ${playlistFiles.length} | URLs: ${results.length} | Live: ${live} | Down: ${down} | Errors: ${errors}`,
  `Settings: timeout ${timeoutMs} ms, ${retries} retries, concurrency ${concurrency}`, '',
  '| Playlist | URLs | Live | Down | Errors |', '|---|---:|---:|---:|---:|',
  ...[...byFile.entries()].map(([file, n]) => `| ${file.replaceAll('|', '\\|')} | ${n.total} | ${n.live} | ${n.down} | ${n.error} |`), '',
  '## Unavailable or failed URLs', '',
  ...results.filter(r => r.status !== 'LIVE').map(r => `- **${r.status}** — \`${r.file}:${r.line}\` — ${r.error} — ${r.url}`),
  ...(results.every(r => r.status === 'LIVE') ? ['All playlist URLs responded successfully.'] : []), '',
].join('\n');
await writeFile(path.join(outDir, 'm3u-status.md'), markdown);
console.log(`Finished: ${live} live, ${down} down, ${errors} errors. Reports written to ${outDir}`);
