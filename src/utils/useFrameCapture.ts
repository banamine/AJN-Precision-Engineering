import { useEffect } from 'react';
import { needsCapture, saveCaptured } from './thumbStore';

/** While a video plays, save one real frame (160 px wide JPEG) for an item Archive has no image for.
 *  Never captures black frames, never throws (a cross-origin canvas just means no capture), at most 3 tries per play. */
export function useFrameCapture(mediaRef: { current: HTMLMediaElement | null }, key: string | null | undefined, isVideo: boolean): void {
  useEffect(() => {
    const media = mediaRef.current;
    if (!isVideo || !key || !(media instanceof HTMLVideoElement)) return;
    let tries = 0; let lastTry = -10;
    const onTime = () => {
      if (tries >= 3 || media.currentTime < 5 || media.currentTime - lastTry < 5) return;
      if (!needsCapture(key) || media.readyState < 2 || !media.videoWidth) return;
      tries++; lastTry = media.currentTime;
      try {
        const w = 160, h = Math.max(1, Math.round((w * media.videoHeight) / media.videoWidth));
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        ctx.drawImage(media, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data; let sum = 0;
        for (let p = 0; p < px.length; p += 4) sum += px[p] + px[p + 1] + px[p + 2];
        if (sum / (px.length / 4 * 3) < 14) return; // black frame: try again later
        saveCaptured(key, canvas.toDataURL('image/jpeg', 0.6));
      } catch { tries = 3; /* tainted canvas or storage error: give up for this play */ }
    };
    media.addEventListener('timeupdate', onTime);
    return () => media.removeEventListener('timeupdate', onTime);
  }, [mediaRef, key, isVideo]);
}
