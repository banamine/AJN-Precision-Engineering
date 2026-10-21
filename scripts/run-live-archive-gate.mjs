#!/usr/bin/env node
// Runs a test that talks to the live Internet Archive. If it fails AND Archive is unreachable
// (two quick HEAD probes fail), the failure is reported as a warning and CI passes: an outage
// outside our control must not block merges or deploys. If Archive is up, the failure is real
// and stays blocking.
// Usage: node scripts/run-live-archive-gate.mjs <command> [args...]
import { spawnSync } from 'node:child_process';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) { console.error('usage: run-live-archive-gate.mjs <command> [args...]'); process.exit(2); }

const run = spawnSync(cmd, args, { stdio: 'inherit' });
if (run.status === 0) process.exit(0);

async function archiveUp() {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch('https://archive.org/', { method: 'HEAD', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'AJN-CI-Live-Archive-Gate/1.0' } });
      await res.body?.cancel().catch(() => {});
      if (res.status >= 200 && res.status < 400) return true;
    } catch { /* unreachable: try again */ } finally { clearTimeout(timer); }
  }
  return false;
}

if (await archiveUp()) {
  console.error('Live Archive gate FAILED while Archive is reachable: treating as a real regression.');
  process.exit(run.status ?? 1);
}
console.log('::warning::Live Archive gate failed and archive.org is unreachable from this runner; skipping so an Archive outage does not block CI. Re-run when Archive is back.');
process.exit(0);
