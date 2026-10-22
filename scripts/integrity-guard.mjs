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

// 5. no builder-environment hostnames in lockfiles or tracked configs (e.g. Replit's package-firewall.replit.internal
// made `npm ci` fail in CI with ENOTFOUND). Docs and this guard itself are exempt.
const ENV_HOST = /[a-z0-9.-]*\.replit\.internal\b/i;
const exempt = (f) => /\.(md|txt)$/i.test(f) || f === 'scripts/integrity-guard.mjs';
for (const f of tracked) {
  if (exempt(f) || !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.npmrc|Dockerfile)$/.test(f)) continue;
  try {
    const hit = readFileSync(f, 'utf8').match(ENV_HOST);
    if (hit) fail(`${f} contains a builder-environment host (${hit[0]}); regenerate it against registry.npmjs.org`);
  } catch { /* unreadable or deleted: other checks cover it */ }
}

// 6. deletions vs base
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
