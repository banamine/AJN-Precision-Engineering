import { buildArchiveProxyUrl } from './archivePlayback';

export interface ArchiveAssetValidationResult {
  valid: boolean;
  duration?: number;
  errorCode?: string;
}

export async function validateArchiveAsset(
  page: any,
  archivePath: string,
  title: string,
  timeoutMs = 10_000,
): Promise<ArchiveAssetValidationResult> {
  const path = String(archivePath ?? '').trim();
  if (!path.startsWith('/download/')) {
    return { valid: false, errorCode: 'INVALID_ARCHIVE_PATH' };
  }

  const proxyUrl = buildArchiveProxyUrl(path);

  try {
    const result = await page.evaluate(
      async ({ src, timeout }) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;

        return await new Promise((resolve) => {
          let settled = false;
          let timer: ReturnType<typeof setTimeout>;
          const finish = (value: any) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('error', onError);
            video.remove();
            resolve(value);
          };

          const onLoadedMetadata = () =>
            finish({ valid: true, duration: Number.isFinite(video.duration) ? video.duration : undefined });

          const onError = () => {
            const mediaError = video.error;
            const detail = mediaError
              ? `MEDIA_ELEMENT_ERROR: ${mediaError.message || mediaError.code || 'Format error'}`
              : 'MEDIA_ELEMENT_ERROR: Format error';
            finish({ valid: false, errorCode: detail });
          };

          timer = setTimeout(() => finish({ valid: false, errorCode: 'TIMEOUT' }), timeout);
          video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
          video.addEventListener('error', onError, { once: true });
          video.src = src;
          video.load();
        });
      },
      { src: proxyUrl, timeout: timeoutMs },
    );

    const normalized = result as ArchiveAssetValidationResult;
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
