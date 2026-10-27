#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const registryPath = path.join(root, 'tools/ajn-verify/registry.json');
const guardPath = path.join(root, 'tools/ajn-verify/net-guard.mjs');
const browserGuardPath = path.join(root, 'tools/ajn-verify/browser-guard.mjs');

export function hashMatchStatus(previous, current, determinism = 'deterministic') {
  if (determinism !== 'deterministic' || !previous || previous === 'non-deterministic') return 'n/a';
  return previous === current ? 'yes' : 'no';
}

export function classifyResult({ exitCode, timedOut = false, blockedHosts = [], stderr = '', stdout = '', missingDependency = false, localServerMissing = false }) {
  if (timedOut) return 'TIMEOUT';
  if (exitCode === 0) return 'PASS';
  if (missingDependency) return 'BLOCKED-DEPENDENCY';
  if (localServerMissing) return 'NEEDS-STUB';
  const guardFailure = /ENETGUARD|net-guard: outbound request/i.test(`${stderr}\n${stdout}`);
  const browserBlocked = /ERR_PROXY_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_REFUSED/i.test(`${stderr}\n${stdout}`);
  if (blockedHosts.length && guardFailure) return 'NEEDS-STUB';
  if (browserBlocked) return 'NEEDS-STUB';
  return 'FAIL';
}

export function isRegression({ seed = false, baselineStatus, status, hashMatch }) {
  return !seed && baselineStatus === 'PASS' && (status !== 'PASS' || hashMatch === 'no');
}

export function normalizeDurationMsLines(text) {
  let count = 0;
  const normalized = String(text).replace(
    /^([ \t]*(?:(?:#|ℹ)[ \t]*)?duration_ms["']?(?:[ \t]*:[ \t]*|[ \t]+))[-+]?(?:\d+(?:\.\d*)?|\.\d+)([ \t]*(?:ms)?[ \t]*\r?)$/gim,
    (_line, prefix, suffix) => {
      count++;
      return `${prefix}<duration_ms>${suffix}`;
    },
  );
  return { text: normalized, count };
}

export function createDurationMsNormalizer() {
  let pending = '';
  let count = 0;
  const normalize = (text) => {
    const result = normalizeDurationMsLines(text);
    count += result.count;
    return result.text;
  };
  return {
    push(text) {
      pending += text;
      const lastNewline = pending.lastIndexOf('\n');
      if (lastNewline < 0) return '';
      const completeLines = pending.slice(0, lastNewline + 1);
      pending = pending.slice(lastNewline + 1);
      return normalize(completeLines);
    },
    finish() {
      const remainder = pending;
      pending = '';
      return normalize(remainder);
    },
    get normalizedLines() {
      return count;
    },
  };
}

export function isDeterministicStdout(text) {
  return !/(?:\b\d+(?:\.\d+)?\s?ms\b|\b(?:elapsed|duration|latency|timestamp|random|nonce)\b|(?:^|\s)https?:\/\/)/i.test(text);
}

export function signalProcessGroup(child, signal) {
  if (!child?.pid) return false;
  if (process.platform === 'win32') return child.kill(signal);
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function parseArgs(argv) {
  const result = { mode: null, files: [], seed: false, timeout: null };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--all' || value === '--changed') result.mode = value.slice(2);
    else if (value === '--seed') result.seed = true;
    else if (value === '--files') result.files = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (value === '--timeout-ms') result.timeout = Number(argv[++i]);
  }
  return result;
}

function gitChangedFiles() {
  if (!fs.existsSync(path.join(root, '.git'))) return [];
  const diff = spawnSyncText('git', ['diff', '--name-only', 'HEAD']);
  const status = spawnSyncText('git', ['status', '--porcelain']);
  const untracked = status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
  return [...new Set([...diff.split(/\r?\n/), ...untracked].filter(Boolean))];
}

function spawnSyncText(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function changedPaths(args) {
  if (args.files.length) return args.files;
  const fromEnv = (process.env.AJN_VERIFY_CHANGED ?? '').split(path.delimiter).map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : gitChangedFiles();
}

function selectTests(registry, args) {
  if (args.mode === 'all') return registry.tests;
  if (args.mode !== 'changed') throw new Error('Choose --all or --changed.');
  const files = changedPaths(args);
  const ids = new Set(files.flatMap((file) => registry.fileToTests[file.replaceAll('\\', '/')] ?? []));
  return registry.tests.filter((test) => ids.has(test.id));
}

function parseGuardLog(logPath) {
  if (!fs.existsSync(logPath)) return { attempts: 0, blockedHosts: [] };
  const hosts = new Set();
  let attempts = 0;
  for (const line of fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
    try {
      const row = JSON.parse(line);
      attempts++;
      if (row.blocked) hosts.add(String(row.host));
    } catch { /* malformed transient guard line is not evidence */ }
  }
  return { attempts, blockedHosts: [...hosts].sort() };
}

function runOne(test, baseEnv, workDir, overrideTimeout, seed = false) {
  return new Promise((resolve) => {
    const safeId = test.id.replace(/[^A-Za-z0-9_.-]/g, '_');
    const logPath = path.join(workDir, `${safeId}.ndjson`);
    const rawOutHash = crypto.createHash('sha256');
    const outHash = crypto.createHash('sha256');
    const stdoutDecoder = new StringDecoder('utf8');
    const stdoutNormalizer = createDurationMsNormalizer();
    let sample = '';
    let errorSample = '';
    const started = Date.now();
    const consumeNormalized = (text) => {
      if (!text) return;
      outHash.update(text);
      if (sample.length < 12000) sample += text.slice(0, 12000 - sample.length);
    };
    const consumeStdout = (chunk) => {
      rawOutHash.update(chunk);
      consumeNormalized(stdoutNormalizer.push(stdoutDecoder.write(chunk)));
    };
    const env = {
      ...baseEnv,
      NET_GUARD: 'block',
      NET_GUARD_LOG: logPath,
      NET_GUARD_BUDGET_HOSTS: 'archive.org',
      ALLOW_HOSTS: 'localhost,127.0.0.1,::1,[::1]',
    };
    const preload = `--import=${guardPath} --import=${browserGuardPath}`;
    env.NODE_OPTIONS = [env.NODE_OPTIONS, preload].filter(Boolean).join(' ').trim();
    const child = spawn('bash', ['-lc', test.command], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    child.stdout.on('data', consumeStdout);
    child.stderr.on('data', (chunk) => {
      if (errorSample.length < 12000) errorSample += chunk.toString('utf8').slice(0, 12000 - errorSample.length);
    });
    let timedOut = false;
    const timeoutMs = overrideTimeout || test.timeoutMs || 30000;
    const timer = setTimeout(() => {
      timedOut = true;
      signalProcessGroup(child, 'SIGTERM');
      setTimeout(() => signalProcessGroup(child, 'SIGKILL'), 1500).unref();
    }, timeoutMs);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      consumeNormalized(stdoutNormalizer.push(stdoutDecoder.end()));
      consumeNormalized(stdoutNormalizer.finish());
      const guard = parseGuardLog(logPath);
      const missingDependency = /ERR_MODULE_NOT_FOUND|Cannot find package ['"]playwright|Cannot find module ['"]playwright/i.test(errorSample);
      const localServerMissing = /ECONNREFUSED.*(?:127\.0\.0\.1|localhost)|connect ECONNREFUSED/i.test(`${errorSample}\n${sample}`) && /(?:browser-journeys|accessibility|AJN_TEST_URL|localhost:3000)/i.test(`${test.command}\n${test.file}`);
      const status = classifyResult({ exitCode, timedOut, blockedHosts: guard.blockedHosts, stderr: errorSample, stdout: sample, missingDependency, localServerMissing });
      const stdoutHash = outHash.digest('hex');
      const rawStdoutHash = rawOutHash.digest('hex');
      const deterministicByOutput = isDeterministicStdout(sample);
      const determinism = test.determinism === 'non-deterministic' || !deterministicByOutput ? 'non-deterministic' : 'deterministic';
      const previous = test.lastKnownGoodStdoutSha256;
      const match = hashMatchStatus(previous, stdoutHash, determinism);
      const elapsedSec = Math.round((Date.now() - started) / 100) / 10;
      const regression = isRegression({ seed, baselineStatus: test.baselineStatus, status, hashMatch: match });
      resolve({
        id: test.id, kind: test.kind, command: test.command, status, exitCode,
        signal: signal ?? null, seconds: elapsedSec, timeoutMs,
        guardAttempts: guard.attempts, blockedHosts: guard.blockedHosts,
        stdoutSha256: stdoutHash, stdoutHashMatch: match, determinism,
        timingLinesNormalized: stdoutNormalizer.normalizedLines,
        hashChangedByNormalization: rawStdoutHash !== stdoutHash,
        regression, needs: [...new Set([...(test.needs ?? []), ...(status === 'NEEDS-STUB' ? ['network=needs-stub'] : [])])],
        failureClass: status === 'FAIL' ? 'non-zero exit without a confirmed blocked-network or missing-local-fixture cause' : null,
      });
    });
  });
}

function reportMarkdown(results, meta) {
  const regressions = results.filter((result) => result.regression);
  const counts = Object.fromEntries(['PASS', 'NEEDS-STUB', 'NEEDS-HARNESS', 'BLOCKED-DEPENDENCY', 'FAIL', 'TIMEOUT'].map((status) => [status, results.filter((r) => r.status === status).length]));
  counts.NON_DETERMINISTIC = results.filter((r) => r.determinism === 'non-deterministic').length;
  const lines = [];
  if (regressions.length) {
    lines.push('# REGRESSION — previously passing test failed or its deterministic stdout hash changed', '');
    for (const regression of regressions) lines.push(`- ${regression.id}: ${regression.status}; hash match ${regression.stdoutHashMatch}.`);
    lines.push('');
  }
  lines.push('# AJN verify run report', '', `Mode: ${meta.mode}; seeded: ${meta.seed ? 'yes' : 'no'}; selected: ${results.length}.`, '',
    `Counts: PASS ${counts.PASS}, NEEDS-STUB ${counts['NEEDS-STUB']}, BLOCKED-DEPENDENCY ${counts['BLOCKED-DEPENDENCY']}, FAIL ${counts.FAIL}, TIMEOUT ${counts.TIMEOUT}, non-deterministic ${counts.NON_DETERMINISTIC}.`, '',
    '| Test | Status | Seconds | Guard attempts | Blocked hosts | Timing lines normalized | Hash match |',
    '|---|---:|---:|---:|---|---:|---|');
  for (const row of results) lines.push(`| ${row.id} | ${row.status} | ${row.seconds} | ${row.guardAttempts} | ${row.blockedHosts.join(', ') || 'none'} | ${row.timingLinesNormalized ?? 0} | ${row.stdoutHashMatch} |`);
  lines.push('', 'Raw stdout/stderr and request paths were held transiently in memory only; only SHA-256, counts, hostnames, and exit classifications are retained.');
  return `${lines.join('\n')}\n`;
}

export async function runVerification({ mode, files = [], seed = false, timeout = null } = {}) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const selectedTests = selectTests(registry, { mode, files });
  const tests = [...selectedTests.filter((test) => !test.slow), ...selectedTests.filter((test) => test.slow)];
  if (!tests.length) {
    const report = { schemaVersion: 1, mode, seed, selected: 0, message: mode === 'changed' ? 'No mapped tests selected; git metadata or an explicit changed-file list is required.' : 'No tests found.', results: [], regressions: [] };
    fs.mkdirSync(path.join(root, 'REVIEW'), { recursive: true });
    fs.writeFileSync(path.join(root, 'REVIEW/verify-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(root, 'REVIEW/verify-report.md'), reportMarkdown([], { mode, seed }));
    return report;
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajn-verify-'));
  const baseEnv = { ...process.env };
  const results = [];
  try {
    for (const test of tests) {
      if (test.needs?.includes('needs-harness')) {
        const result = {
          id: test.id, kind: test.kind, command: test.command, status: 'NEEDS-HARNESS', exitCode: null,
          signal: null, seconds: 0, timeoutMs: test.timeoutMs ?? 0, guardAttempts: 0, blockedHosts: [],
          stdoutSha256: null, stdoutHashMatch: 'n/a', determinism: test.determinism ?? 'non-deterministic',
          regression: false, needs: test.needs, failureClass: 'not run: browser fixture entry requires its owning harness',
        };
        results.push(result);
        if (seed) {
          const target = registry.tests.find((candidate) => candidate.id === result.id);
          if (target) {
            target.baselineStatus = 'NEEDS-HARNESS';
            target.lastKnownGoodStdoutSha256 = 'not-applicable (browser fixture entry)';
            target.lastRun = { status: 'NEEDS-HARNESS', seconds: 0, guardAttempts: 0, blockedHosts: [] };
          }
        }
        process.stdout.write(`SKIP ${test.id} NEEDS-HARNESS (browser entry fixture)\n`);
        continue;
      }
      if (!seed && test.needs?.includes('needs-stub')) {
        results.push({
          id: test.id, kind: test.kind, command: test.command, status: 'NEEDS-STUB', exitCode: null,
          signal: null, seconds: 0, timeoutMs: test.timeoutMs ?? 0, guardAttempts: 0, blockedHosts: [],
          stdoutSha256: null, stdoutHashMatch: 'n/a', determinism: test.determinism ?? 'non-deterministic',
          regression: false, needs: test.needs, failureClass: 'not run: required offline stub is not configured',
        });
        process.stdout.write(`SKIP ${test.id} NEEDS-STUB (no live network)\n`);
        continue;
      }
      process.stdout.write(`RUN ${test.id}\n`);
      results.push(await runOne(test, baseEnv, workDir, timeout, seed));
      const result = results.at(-1);
      if (seed && result.status === 'PASS' && result.determinism === 'deterministic') result.stdoutHashMatch = 'yes';
      process.stdout.write(`DONE ${result.id} ${result.status} ${result.seconds}s guards=${result.guardAttempts} hash=${result.stdoutHashMatch}\n`);
      if (seed) {
        const target = registry.tests.find((candidate) => candidate.id === result.id);
        if (target) {
          target.baselineStatus = result.status;
          target.determinism = result.determinism;
          target.lastKnownGoodStdoutSha256 = result.determinism === 'non-deterministic'
            ? 'non-deterministic'
            : result.status === 'PASS' ? result.stdoutSha256 : 'unavailable (no passing baseline)';
          if (result.status === 'NEEDS-STUB' && !target.needs.includes('needs-stub')) target.needs.push('needs-stub');
          target.lastRun = { status: result.status, seconds: result.seconds, guardAttempts: result.guardAttempts, blockedHosts: result.blockedHosts };
        }
      }
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  if (seed) fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  const report = {
    schemaVersion: 1, mode, seed, selected: results.length,
    counts: Object.fromEntries([
      ...['PASS', 'NEEDS-STUB', 'NEEDS-HARNESS', 'BLOCKED-DEPENDENCY', 'FAIL', 'TIMEOUT'].map((status) => [status, results.filter((r) => r.status === status).length]),
      ['NON_DETERMINISTIC', results.filter((r) => r.determinism === 'non-deterministic').length],
    ]),
    regressions: results.filter((result) => result.regression).map((result) => result.id),
    results,
  };
  fs.mkdirSync(path.join(root, 'REVIEW'), { recursive: true });
  fs.writeFileSync(path.join(root, 'REVIEW/verify-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'REVIEW/verify-report.md'), reportMarkdown(results, { mode, seed }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.mode) throw new Error('Usage: node tools/ajn-verify/run.mjs --changed [--files a,b] | --all [--seed] [--timeout-ms N]');
    const report = await runVerification(args);
    console.log(`Summary: selected=${report.selected} pass=${report.counts?.PASS ?? 0} needs-stub=${report.counts?.['NEEDS-STUB'] ?? 0} needs-harness=${report.counts?.['NEEDS-HARNESS'] ?? 0} blocked-dependency=${report.counts?.['BLOCKED-DEPENDENCY'] ?? 0} fail=${report.counts?.FAIL ?? 0} timeout=${report.counts?.TIMEOUT ?? 0} regressions=${report.regressions?.length ?? 0}`);
    if ((report.counts?.FAIL ?? 0) > 0 || (report.counts?.TIMEOUT ?? 0) > 0 || (report.regressions?.length ?? 0) > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`verify runner: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
