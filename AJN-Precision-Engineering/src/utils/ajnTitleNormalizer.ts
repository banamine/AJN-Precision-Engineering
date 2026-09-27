/**
 * Deterministically normalizes AJN media filenames into display titles.
 *
 * Rules are intentionally mechanical:
 * - URL-decode when possible.
 * - Strip query/hash and the final media extension.
 * - Convert separators to spaces.
 * - Collapse repeated whitespace.
 * - Preserve meaningful words and ordering.
 */
export function normalizeAjnFilename(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  const withoutQuery = raw.split("#", 1)[0].split("?", 1)[0];
  const lastSegment = withoutQuery.split("/").filter(Boolean).pop() || withoutQuery;

  let value = lastSegment;
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the original segment; malformed escaping must not invent a title.
  }

  value = value
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return value;
}
