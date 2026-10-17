#!/usr/bin/env node
// AJN integrity guard: fails when a change wipes/rewrites the project (e.g. an AI builder "rebuilding" it).
// Usage: node scripts/integrity-guard.mjs [--base <git-ref>]
// Bypass bulk-delete check ONLY with the text [allow-bulk-delete] in the HEAD commit message.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('integrity-manifest.json', 'utf8'));
const argBase = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : '';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const failures = [];
const fail = (m) => failures.push(m);

// 1. required files exist
for (const f of manifest.requiredFiles) if (!existsSync(f)) fail(`missing required file: ${f}`);

// 2. tracked file count floor
let tracked = [];
try { tracked = git('ls-files').split('\n').filter(Boolean); } catch { fail('git ls-files failed'); }
if (tracked.length < manifest.minTrackedFiles) fail(`only ${tracked.length} tracked files (floor ${manifest.minTrackedFiles}) - looks like a wipe/rewrite`);

// 3. package.json invariants
if (existsSync('package.json')) {
  const p = JSON.parse(readFileSync('package.json', 'utf8'));
  const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
  for (const d of manifest.requiredDependencies) if (!deps[d]) fail(`package.json lost dependency: ${d}`);
  for (const s of manifest.requiredScripts) if (!p.scripts?.[s]) fail(`package.json lost script: ${s}`);
}

// 4. Dockerfile invariants
if (existsSync('Dockerfile')) {
  const d = readFileSync('Dockerfile', 'utf8');
  for (const s of manifest.dockerfileMustContain) if (!d.includes(s)) fail(`Dockerfile no longer contains "${s}"`);
}

// 5. deletions vs base
if (argBase && !/^0+$/.test(argBase)) {
  try {
    const deleted = git('diff', '--name-only', '--diff-filter=D', `${argBase}`, 'HEAD').split('\n').filter(Boolean);
    const req = new Set(manifest.requiredFiles);
    for (const f of deleted) if (req.has(f)) fail(`change deletes protected file: ${f}`);
    const msg = git('log', '-1', '--format=%B');
    const allow = msg.includes('[allow-bulk-delete]');
    if (deleted.length > manifest.maxDeletedFilesPerChange && !allow)
      fail(`change deletes ${deleted.length} files (limit ${manifest.maxDeletedFilesPerChange}); add [allow-bulk-delete] to the HEAD commit message if intended`);
  } catch (e) { fail(`could not diff against base ${argBase}: ${e.message.split('\n')[0]}`); }
}

if (failures.length) {
  console.error('AJN INTEGRITY GUARD: FAILED');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log(`AJN integrity guard: ok (${tracked.length} tracked files)`);
