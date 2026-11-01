import { buildArchiveProxyUrl } from './archivePlayback';

export interface ArchiveAssetValidationResult {
  valid: boolean;
  duration?: number;
  errorCode?: string;
}

/** Error code the proxy returns (HTTP 503 JSON) while its host circuit breaker is open. */
export const ARCHIVE_CIRCUIT_OPEN_CODE = 'AJN_UPSTREAM_CIRCUIT_OPEN';
/** Reported when the proxy was still refusing (circuit open) after one wait + retry. NOT a bad asset. */
export const ARCHIVE_UPSTREAM_UNAVAILABLE = 'UPSTREAM_CIRCUIT_OPEN';
/** Upper bound on total cooldown waits per process, so a dead upstream cannot stall the gate for long. */
export const MAX_CIRCUIT_WAITS = 6;
const DEFAULT_RETRY_AFTER_SECONDS = 20;

let circuitWaitsUsed = 0;

/** Test-only: reset the per-process wait budget. */
export function resetArchiveCircuitWaitBudget(): void {
  circuitWaitsUsed = 0;
}

/**
 * Ask the proxy (same origin as the page) what it answers for this path.
 * Returns the cooldown in seconds when the proxy says its circuit is open, otherwise null.
 * The <video> element only reports "Format error" for a 503, so this reads the JSON body it cannot see.
 */
async function probeCircuitOpen(page: any, proxyUrl: string): Promise<number | null> {
  try {
    const retryAfter = await page.evaluate(async (src: string, code: string, fallback: number) => {
      const res = await fetch(src, { headers: { Range: 'bytes=0-0' } });
      if (res.status !== 503) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      const body = await res.json().catch(() => null);
      if (!body || body.errorCode !== code) return null;
      const seconds = Number(body.retryAfterSeconds);
      return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
    }, proxyUrl, ARCHIVE_CIRCUIT_OPEN_CODE, DEFAULT_RETRY_AFTER_SECONDS);
    return typeof retryAfter === 'number' ? retryAfter : null;
  } catch {
    return null;
  }
}

async function loadMetadataOnce(
  page: any,
  proxyUrl: string,
  timeoutMs: number,
): Promise<ArchiveAssetValidationResult> {
  const script = '(async () => {' +
    'const src = ' + JSON.stringify(proxyUrl) + ';' +
    'const timeout = ' + Math.max(1, Math.floor(timeoutMs)) + ';' +
    'const video = document.createElement("video");' +
    'video.preload = "metadata";' +
    'video.muted = true;' +
    'video.playsInline = true;' +
    'return await new Promise((resolve) => {' +
    'let settled = false; let timer;' +
    'const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); video.removeEventListener("loadedmetadata", onLoadedMetadata); video.removeEventListener("error", onError); video.remove(); resolve(value); };' +
    'const onLoadedMetadata = () => finish({ valid: true, duration: Number.isFinite(video.duration) ? video.duration : undefined });' +
    'const onError = () => { const mediaError = video.error; finish({ valid: false, errorCode: mediaError ? "MEDIA_ELEMENT_ERROR: " + (mediaError.message || mediaError.code || "Format error") : "MEDIA_ELEMENT_ERROR: Format error" }); };' +
    'timer = setTimeout(() => finish({ valid: false, errorCode: "TIMEOUT" }), timeout);' +
    'video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });' +
    'video.addEventListener("error", onError, { once: true });' +
    'video.src = src; video.load();' +
    '});' +
    '})()';
  return (await page.evaluate(script)) as ArchiveAssetValidationResult;
}

const isMediaElementError = (r: ArchiveAssetValidationResult): boolean =>
  !r.valid && typeof r.errorCode === 'string' && r.errorCode.startsWith('MEDIA_ELEMENT_ERROR');

export async function validateArchiveAsset(
  page: any,
  archivePath: string,
  title: string,
  timeoutMs = 10_000,
): Promise<ArchiveAssetValidationResult> {
  const path = String(archivePath ?? '').trim();
  if (!path.startsWith('/download/')) return { valid: false, errorCode: 'INVALID_ARCHIVE_PATH' };
  const proxyUrl = buildArchiveProxyUrl(path);

  try {
    let normalized = await loadMetadataOnce(page, proxyUrl, timeoutMs);

    // A 503 from the proxy's open circuit makes <video> report "Format error" in milliseconds.
    // That says nothing about this asset. Only on that fast media error (never on TIMEOUT, so the
    // probe cannot add a timeout to the breaker): ask the proxy, and if its circuit is open, wait
    // out the cooldown it reported and try this same asset once more.
    if (isMediaElementError(normalized) && circuitWaitsUsed < MAX_CIRCUIT_WAITS) {
      const retryAfterSeconds = await probeCircuitOpen(page, proxyUrl);
      if (retryAfterSeconds !== null) {
        circuitWaitsUsed += 1;
        const waitSeconds = retryAfterSeconds + 1;
        console.log(`[MovieValidator] ~ ${title}: proxy circuit open, waiting ${waitSeconds}s then retrying once (wait ${circuitWaitsUsed}/${MAX_CIRCUIT_WAITS})`);
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
        normalized = await loadMetadataOnce(page, proxyUrl, timeoutMs);
        if (isMediaElementError(normalized) && (await probeCircuitOpen(page, proxyUrl)) !== null) {
          normalized = { valid: false, errorCode: ARCHIVE_UPSTREAM_UNAVAILABLE };
        }
      }
    }

    if (normalized.valid) {
      console.log(`[MovieValidator] ✓ ${title} — ${path} (${normalized.duration ?? 'unknown'}s)`);
    } else {
      console.log(`[MovieValidator] ✗ ${title} — ${path}: ${normalized.errorCode ?? 'UNKNOWN'}`);
    }
    return normalized;
  } catch (error) {
    const errorCode = `PROBE_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    console.log(`[MovieValidator] ! ${title} — ${path}: ${errorCode}`);
    return { valid: false, errorCode };
  }
}
