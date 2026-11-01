#!/usr/bin/env node
// Runs a test that talks to the live Internet Archive. A failure is only forgiven (reported as a
// warning, exit 0) when Archive was genuinely unavailable at the moment of failure, so an outage
// outside our control does not block merges or deploys. Otherwise the failure is real and blocks.
//
// "Unavailable" is judged from BOTH vantage points that matter:
//   1. the CI runner: two quick HEAD probes of Archive's home page (as before), and
//   2. the app under test: GET $AJN_TEST_URL/api/archive/status. The deployed service is the one
//      that actually talks to Archive, so when it reports `down` or `unreachable_from_here` it could
//      not reach Archive even if the CI runner can. (Seen 2026-11-01: Cloud Run got
//      UND_ERR_CONNECT_TIMEOUT from archive.org while the runner's probe succeeded.)
// An unreadable status (`unknown`) or `ok`/`degraded` is never treated as an outage.
// Usage: node scripts/run-live-archive-gate.mjs <command> [args...]
import { spawnSync } from 'node:child_process';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) { console.error('usage: run-live-archive-gate.mjs <command> [args...]'); process.exit(2); }

const run = spawnSync(cmd, args, { stdio: 'inherit' });
if (run.status === 0) process.exit(0);

const ARCHIVE_PROBE_URL = process.env.AJN_GATE_ARCHIVE_PROBE_URL || 'https://archive.org/';
const UNAVAILABLE_APP_STATES = new Set(['down', 'unreachable_from_here']);

async function archiveUp() {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(ARCHIVE_PROBE_URL, { method: 'HEAD', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'AJN-CI-Live-Archive-Gate/1.0' } });
      await res.body?.cancel().catch(() => {});
      if (res.status >= 200 && res.status < 400) return true;
    } catch { /* unreachable: try again */ } finally { clearTimeout(timer); }
  }
  return false;
}

/** Archive health as seen by the app under test. Never throws; failure to read is `unknown`. */
async function appArchiveStatus() {
  const base = process.env.AJN_TEST_URL;
  if (!base) return { state: 'unknown', reason: 'AJN_TEST_URL not set' };
  try {
    const res = await fetch(new URL('/api/archive/status', base), {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'AJN-CI-Live-Archive-Gate/1.0' },
    });
    if (!res.ok) return { state: 'unknown', reason: `HTTP ${res.status}` };
    const body = await res.json();
    return { state: typeof body?.state === 'string' ? body.state : 'unknown', body };
  } catch (error) {
    return { state: 'unknown', reason: error instanceof Error ? error.message : String(error) };
  }
}

// Ask the app first: its status is time-sensitive and the runner probe can take several seconds.
const app = await appArchiveStatus();
const runnerReachesArchive = await archiveUp();
console.error(`[live-archive-gate] app archive status: ${JSON.stringify({ state: app.state, reason: app.reason ?? null })}; runner reaches archive.org: ${runnerReachesArchive}`);

const appUnavailable = UNAVAILABLE_APP_STATES.has(app.state);
if (runnerReachesArchive && !appUnavailable) {
  console.error('Live Archive gate FAILED while Archive is reachable: treating as a real regression.');
  process.exit(run.status ?? 1);
}
const why = appUnavailable
  ? `the deployed app reports Archive state "${app.state}" (it cannot reach Archive)`
  : 'archive.org is unreachable from this runner';
console.log(`::warning::Live Archive gate failed and ${why}; skipping so an Archive outage does not block CI. Re-run when Archive is back.`);
process.exit(0);
