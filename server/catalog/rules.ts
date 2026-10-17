/* Catalog content rules. Pure, no Node APIs.
 * 1. English display labels: Cyrillic is removed from the DISPLAY title only; the original is always kept.
 * 2. Whole-word "sex" exclusion: case-insensitive, and a word means letters/digits on neither side, so
 *    "Essex", "Sussex" and "sexy" do not match, while "Sex Ed", "sex-tape" and "sex_ed.mp4" do
 *    (underscore is treated as a separator because Archive filenames use it between words). */

const CYRILLIC = /[Ѐ-ԯᲀ-᲏ⷠ-ⷿꙀ-ꚟ]/g;

/** Remove Cyrillic, tidy leftover punctuation. Falls back to "Untitled (<id>)" when fewer than 2 Latin letters remain. */
export function englishLabel(original: unknown, identifier: string): string {
  const raw = String(Array.isArray(original) ? original[0] : original ?? '').normalize('NFC');
  const cleaned = raw.replace(CYRILLIC, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)[,.;:!?\-–—|/\\()\[\]]+(?=\s|$)/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:\-–—|/\\]+|[\s,;:\-–—|/\\]+$/g, '')
    .replace(/\s+/g, ' ').trim();
  const letters = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  return letters >= 2 ? cleaned : `Untitled (${identifier})`;
}
export const hasCyrillic = (s: unknown) => /[Ѐ-ԯ]/.test(String(s ?? ''));

const SEX_WORD = /(^|[^A-Za-z0-9])sex($|[^A-Za-z0-9])/i;

/** Text of a metadata value without HTML tags or inline data: URIs (descriptions can embed base64 images). */
export function plainText(v: unknown): string {
  const s = Array.isArray(v) ? v.join(' ; ') : String(v ?? '');
  return s.replace(/data:[^\s"')]+/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&amp;/g, ' ');
}
export const hasSexWord = (v: unknown) => SEX_WORD.test(plainText(v));

/** Name of the first field containing the whole word "sex", or null. */
export function findSexWord(fields: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(fields)) if (v != null && hasSexWord(v)) return k;
  return null;
}
