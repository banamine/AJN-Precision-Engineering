import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const bundle = path.resolve('dist/server.cjs');
const tempDir = mkdtempSync(path.join(tmpdir(), 'ajn-boot-warmers-'));
const stubFile = path.join(tempDir, 'archive-fetch-stub.cjs');

writeFileSync(stubFile, [
  "globalThis.fetch = async (input, init = {}) => {",
  "  const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;",
  "  const url = new URL(rawUrl);",
  "  if (url.hostname !== 'archive.org' && !url.hostname.endsWith('.archive.org')) {",
  "    throw new Error('blocked unexpected outbound request: ' + url.origin);",
  "  }",
  "  process.stderr.write('[archive-stub] ' + url.hostname + url.pathname + '\\n');",
  "  if (url.pathname === '/download/redirect-test/redirect-test.mp4') {",
  "    return new Response(null, { status: 302, headers: { location: 'https://outside.example/blocked.mp4' } });",
  "  }",
  "  if (url.pathname === '/advancedsearch.php') {",
  "    return Response.json({ response: { docs: [], numFound: 0 } });",
  "  }",
  "  if (url.pathname.startsWith('/metadata/')) {",
  "    return Response.json({ files: [], metadata: {}, dir: '/0/items/synthetic', server: 'dn000000.archive.org' });",
  "  }",
  "  if (url.pathname.endsWith('.m3u') || url.pathname.includes('/services/m3u/')) {",
  "    return new Response('#EXTM3U\\\\n', { status: 200, headers: { 'content-type': 'audio/x-mpegurl' } });",
  "  }",
  "  return new Response('stubbed', { status: 404, headers: { 'content-type': 'text/plain' } });",
  "};",
].join('\n'));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function capture(child: ChildProcessWithoutNullStreams) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  return { get stdout() { return stdout; }, get stderr() { return stderr; } };
}

async function waitFor(predicate: () => boolean, output: { stdout: string; stderr: string }, child: ChildProcessWithoutNullStreams, label: string, ms = 20_000) {
  const until = Date.now() + ms;
  while (!predicate()) {
    if (child.exitCode !== null) throw new Error(`${label}: server exited early\n${output.stdout}\n${output.stderr}`);
    if (Date.now() >= until) throw new Error(`${label}: timed out\n${output.stdout}\n${output.stderr}`);
    await delay(50);
  }
}

async function startServer(enabled: boolean) {
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    LIBRARY_BACKGROUND: enabled ? 'on' : 'off',
    ...(enabled ? { AJN_BOOT_WARMERS: '1' } : {}),
  };
  if (!enabled) delete env.AJN_BOOT_WARMERS;
  const child = spawn(process.execPath, ['-r', stubFile, bundle], { env, stdio: 'pipe' });
  const output = capture(child);
  await waitFor(() => output.stdout.includes('Integrated Server running'), output, child, 'server startup');
  return { child, output, port };
}

async function stopServer(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>(resolve => child.once('close', () => resolve())),
    delay(5_000).then(() => { child.kill('SIGKILL'); }),
  ]);
}

async function main() {
  assert.ok(existsSync(bundle), 'run npm run build before this integration test');

  const disabled = await startServer(false);
  await delay(30_000);
  await stopServer(disabled.child);
  const disabledCalls = disabled.output.stderr.split('\n').filter(line => line.startsWith('[archive-stub]'));
  const disabledLogCount = disabled.output.stdout.split('\n').filter(line =>
    line.includes('Archive boot warmers disabled (set AJN_BOOT_WARMERS=1 to enable)')).length;
  assert.equal(disabledCalls.length, 0, 'default-off server made an Archive request during the 30 s observation');
  assert.equal(disabledLogCount, 1, 'disabled state must be logged once at boot');
  assert.doesNotMatch(disabled.output.stderr, /blocked unexpected outbound request/);
  console.log('PASS boot default OFF: 0 stubbed Archive calls in 30 s; disabled log count = 1');

  const enabled = await startServer(true);
  try {
    await waitFor(() => enabled.output.stderr.includes('[archive-stub]'), enabled.output, enabled.child, 'enabled warmer request');
    assert.ok(
      enabled.output.stderr.includes('/advancedsearch.php') || enabled.output.stderr.includes('/metadata/'),
      'enabled startup should preserve Archive warmer requests',
    );
    const pathParam = encodeURIComponent('/download/redirect-test/redirect-test.mp4');
    const response = await fetch(`http://127.0.0.1:${enabled.port}/api/archive/proxy?path=${pathParam}`);
    const payload = await response.json() as { error?: string; reason?: string; attempts?: number };
    assert.equal(response.status, 502);
    assert.equal(payload.error, 'Archive redirect rejected');
    assert.equal(payload.reason, 'Archive redirect rejected: outside.example');
    assert.equal(payload.attempts, 1);
    await delay(1_600);
    const redirectAttempts = enabled.output.stderr.split('\n')
      .filter(line => line.startsWith('[archive-stub]') && line.includes('/download/redirect-test/redirect-test.mp4'));
    assert.equal(redirectAttempts.length, 1, 'unsafe redirect must have one request total, with zero retries');
    assert.doesNotMatch(enabled.output.stderr, /blocked unexpected outbound request/);
    console.log('PASS boot opt-in ON: Archive warmer requests observed through stub');
    console.log('PASS local proxy route: HTTP 502 with redirect reason; 1 request, 0 retries, no external hop');
  } finally {
    await stopServer(enabled.child);
  }
}

main().finally(() => rmSync(tempDir, { recursive: true, force: true })).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
