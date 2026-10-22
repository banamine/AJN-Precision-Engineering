#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { classifyResult, hashMatchStatus, isRegression, createDurationMsNormalizer, normalizeDurationMsLines, isDeterministicStdout, signalProcessGroup } from './run.mjs';
import { isProtectedPath, placementVerdict } from './where.mjs';
import { parseUploadOrder, scanFile } from './rules.mjs';
import { commandForFile, isBrowserFixtureEntry } from './seed.mjs';
import { assertPackAllowed } from './pack.mjs';

assert.equal(classifyResult({ exitCode: 0 }), 'PASS', 'synthetic passing test must pass');
assert.equal(classifyResult({ exitCode: 1 }), 'FAIL', 'synthetic failing test must fail');
assert.equal(hashMatchStatus('abc', 'def', 'deterministic'), 'no', 'changed stdout hash must be detected');
assert.equal(hashMatchStatus('abc', 'abc', 'deterministic'), 'yes', 'unchanged stdout hash must match');
const timingNormalizer = createDurationMsNormalizer();
const normalizedTimingOutput =
  timingNormalizer.push('# duration_ms: 10.') +
  timingNormalizer.push('25\r\nℹ duration_ms 7\nmeaningful output\n') +
  timingNormalizer.finish();
assert.equal(normalizedTimingOutput, '# duration_ms: <duration_ms>\r\nℹ duration_ms <duration_ms>\nmeaningful output\n');
assert.equal(timingNormalizer.normalizedLines, 2, 'duration_ms lines split across chunks are normalized and counted');
assert.equal(isDeterministicStdout(normalizedTimingOutput), true, 'duration_ms-only timing is ignored by the determinism check after normalization');
const dataDuration = normalizeDurationMsLines('{"duration_ms":17,"value":"keep"}\n');
assert.equal(dataDuration.count, 0, 'JSON data lines are not treated as runner timing');
assert.equal(dataDuration.text, '{"duration_ms":17,"value":"keep"}\n', 'meaningful JSON output remains byte-for-byte intact');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const timingRunA = '# result ok\n# duration_ms 10.25\n';
const timingRunB = '# result ok\n# duration_ms 99.75\n';
const stableA = createDurationMsNormalizer();
const stableB = createDurationMsNormalizer();
const hashA = stableA.push(timingRunA) + stableA.finish();
const hashB = stableB.push(timingRunB) + stableB.finish();
assert.equal(hash(hashA), hash(hashB), 'runs differing only in duration_ms hash identically after normalization');
assert.equal(hashMatchStatus(hash(hashA), hash(hashB), 'deterministic'), 'yes', 'normalized hashes match');
const realDifference = createDurationMsNormalizer();
const changedOutput = realDifference.push('# result changed\n# duration_ms 10.25\n') + realDifference.finish();
assert.equal(hashMatchStatus(hash(hashA), hash(changedOutput), 'deterministic'), 'no', 'real stdout differences still fail hash comparison');
assert.equal(isDeterministicStdout('elapsed: 9 ms'), false, 'other variable timing output remains non-deterministic');
if (process.platform !== 'win32') {
  const grandchildScript = "const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(child.pid); setInterval(() => {}, 1000);";
  const groupParent = spawn(process.execPath, ['-e', grandchildScript], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const groupClosed = new Promise((resolve) => groupParent.once('close', resolve));
  let descendantPidText = '';
  groupParent.stdout.setEncoding('utf8');
  groupParent.stdout.on('data', (chunk) => { descendantPidText += chunk; });
  await new Promise((resolve, reject) => {
    const readyTimer = setTimeout(() => reject(new Error('process-group self-test child did not start')), 3_000);
    groupParent.stdout.once('data', () => { clearTimeout(readyTimer); resolve(); });
    groupParent.once('error', reject);
  });
  const descendantPid = Number(descendantPidText.trim().split(/\s+/).at(-1));
  assert.ok(Number.isInteger(descendantPid) && descendantPid > 0, 'descendant PID was reported');
  assert.equal(signalProcessGroup(groupParent, 'SIGTERM'), true, 'SIGTERM targets the isolated process group');
  await new Promise((resolve) => setTimeout(resolve, 150));
  signalProcessGroup(groupParent, 'SIGKILL');
  await Promise.race([
    groupClosed,
    new Promise((_, reject) => setTimeout(() => reject(new Error('process-group self-test child did not close')), 3_000)),
  ]);
  let descendantAlive = true;
  try { process.kill(descendantPid, 0); } catch (error) {
    if (error.code === 'ESRCH') descendantAlive = false;
    else throw error;
  }
  assert.equal(descendantAlive, false, 'group escalation terminates a child process and its descendant');
}
assert.equal(isRegression({ seed: true, baselineStatus: 'PASS', status: 'PASS', hashMatch: 'no' }), false, 'seeding must not compare against the previous baseline');
assert.equal(isRegression({ baselineStatus: 'PASS', status: 'FAIL', hashMatch: 'n/a' }), true, 'a failing changed run must be a regression');
assert.equal(isProtectedPath('src/core/UnifiedPlaybackEngine.ts'), true, 'protected core edit must be detected');
assert.equal(placementVerdict('src/components/NewPanel.tsx').verdict, 'OK');
assert.equal(placementVerdict('src/not-a-placement/NewPanel.tsx').verdict, 'wrong place', 'bad placement must be detected');
assert.deepEqual(parseUploadOrder('1. src/a.ts | 10 | abc\n2. server/b.ts | 20 | def'), ['src/a.ts', 'server/b.ts']);
assert.equal(commandForFile('test-genre-expansion.js', {}, 'import { x } from "./src/x.ts";'), 'node_modules/.bin/tsx test-genre-expansion.js');
assert.equal(commandForFile('test-movies-classics.js', { 'test:movies-classics': 'tsx test-movies-classics.js' }), 'node_modules/.bin/tsx test-movies-classics.js');
assert.equal(isBrowserFixtureEntry('test-radio-caption-browser-entry.tsx'), true, 'tsx UI entry must use its browser harness');
assert.equal(isBrowserFixtureEntry('test-audio-light-schedule.ts'), false, 'pure TypeScript test remains runnable by tsx');
assert.equal(isBrowserFixtureEntry('test-caption-strip-output.tsx'), false, 'server-rendered TSX test remains runnable by tsx');

const packRegistry = {
  tests: [{ id: 'kit:self-test', baselineStatus: 'PASS', determinism: 'deterministic', lastKnownGoodStdoutSha256: 'a'.repeat(64) }],
  fileToTests: { 'tools/ajn-verify/self-test.mjs': ['kit:self-test'] },
};
const packReport = { results: [{ id: 'kit:self-test', status: 'PASS', regression: false }], regressions: [] };
const packFiles = ['tools/ajn-verify/self-test.mjs', 'REVIEW/REPORT.md'];
assert.doesNotThrow(() => assertPackAllowed(
  { results: [
    { id: 'kit:self-test', status: 'PASS', regression: false },
    { id: 'old-baseline-failure', status: 'FAIL', regression: false },
  ], regressions: [] },
  { tests: [{ id: 'old-baseline-failure', baselineStatus: 'FAIL', determinism: 'non-deterministic' }], fileToTests: { 'tools/ajn-verify/self-test.mjs': ['kit:self-test'] } },
  { includedFiles: ['tools/ajn-verify/self-test.mjs'], requiredFiles: ['REVIEW/REPORT.md'], availableFiles: packFiles },
), 'an inherited failure outside the kit mapping must not block packaging');
assert.throws(() => assertPackAllowed(
  { ...packReport, results: [{ id: 'kit:self-test', status: 'PASS', regression: true }] },
  packRegistry,
  { includedFiles: ['tools/ajn-verify/self-test.mjs'], requiredFiles: ['REVIEW/REPORT.md'], availableFiles: packFiles },
), /regressions=1/, 'a regression must block packaging');
assert.throws(() => assertPackAllowed(
  { ...packReport, results: [{ id: 'kit:self-test', status: 'FAIL', regression: false }] },
  packRegistry,
  { includedFiles: ['tools/ajn-verify/self-test.mjs'], requiredFiles: ['REVIEW/REPORT.md'], availableFiles: packFiles },
), /mapped to packaged files/, 'a mapped failing test must block packaging');
assert.throws(() => assertPackAllowed(
  { ...packReport, results: [{ id: 'kit:self-test', status: 'TIMEOUT', regression: false }] },
  packRegistry,
  { includedFiles: ['tools/ajn-verify/self-test.mjs'], requiredFiles: ['REVIEW/REPORT.md'], availableFiles: packFiles },
), /mapped to packaged files/, 'a mapped timeout must block packaging');
assert.throws(() => assertPackAllowed(
  packReport,
  packRegistry,
  { includedFiles: ['tools/ajn-verify/missing.mjs'], requiredFiles: ['REVIEW/REPORT.md'], availableFiles: packFiles },
), /missing required file/, 'a missing packaged file must block packaging');
assert.throws(() => assertPackAllowed(
  packReport,
  { tests: [{ id: 'kit:self-test', baselineStatus: 'PASS', determinism: 'deterministic', lastKnownGoodStdoutSha256: '' }], fileToTests: { 'tools/ajn-verify/self-test.mjs': ['kit:self-test'] } },
  { includedFiles: ['tools/ajn-verify/self-test.mjs'], requiredFiles: ['REVIEW/REPORT.md'], availableFiles: packFiles },
), /lack a 64-char/, 'a missing deterministic baseline hash must block packaging');
assert.throws(() => assertPackAllowed({}, packRegistry, { availableFiles: packFiles }), /malformed/, 'a malformed report must block packaging');

const lint = scanFile('src/analytics/metrics.ts', [
  'export const sample = Math.random();',
  'const value: any = null;',
  'fetch(\"/api/x\");',
].join('\n'));
assert.deepEqual([...new Set(lint.map((item) => item.code))].sort(), ['RELATIVE_API', 'TS_ANY', 'RANDOM_TELEMETRY'].sort());

console.log('VERIFYKIT_SELF_TEST_PASS cases=33');
