/** True when a Desk story title looks like real words, not OCR garbage from a scanned page. */
export function isReadableTitle(title: string | undefined | null): boolean {
  const t = (title ?? '').trim();
  if (t.length < 6) return false;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (letters / t.length < 0.6) return false;
  if (/[^\p{L}\p{N}\s]{3,}/u.test(t)) return false;
  const words = t.split(/\s+/);
  const short = words.filter((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length <= 1).length;
  if (words.length >= 4 && short / words.length > 0.4) return false;
  if (/\b[bcdfghjklmnpqrstvwxz]{6,}\b/i.test(t)) return false;
  return true;
}
