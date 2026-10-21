const url = 'https://archive.org/';
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5_000);

try {
  const response = await fetch(url, {
    method: 'HEAD',
    redirect: 'manual',
    signal: controller.signal,
    headers: { 'User-Agent': 'AJN-CI-Archive-Preflight/1.0', Accept: '*/*' },
  });
  const archiveUp = response.status >= 200 && response.status < 300;
  console.log(`archive_up=${archiveUp}`);
  if (!archiveUp) {
    console.log(`::warning::Archive availability preflight returned HTTP ${response.status}; this result is informational only.`);
  }
  await response.body?.cancel().catch(() => {});
} catch {
  console.log('archive_up=false');
  console.log('::warning::Archive availability preflight could not reach Archive; this result is informational only.');
} finally {
  clearTimeout(timeout);
}

// Availability is informational and must never determine CI or deployment status.
process.exitCode = 0;
