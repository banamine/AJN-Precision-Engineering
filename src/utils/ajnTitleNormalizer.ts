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


const LEGACY_VIDEO_FILENAME_PATTERN = /^VIDEO - (\d{4})(\d{2})(\d{2})(.*)$/;

export function renameLegacyAjnVideoFilename(input: string, replacementPrefix: string): string {
  const value = String(input ?? "").trim();
  const prefix = String(replacementPrefix ?? "").trim();
  if (!value || !prefix) return value;
  return value.replace(
    LEGACY_VIDEO_FILENAME_PATTERN,
    `${prefix} $1-$2-$3$4`,
  );
}

export function inferLegacyAjnVideoPrefix(input: string): "WAR-ROOM" | "ALEX-JONES" | undefined {
  const value = String(input ?? "");
  if (/WarRoom/i.test(value)) return "WAR-ROOM";
  if (/AlexJones|Alex[_ -]?Jones/i.test(value)) return "ALEX-JONES";
  return undefined;
}

export function normalizeLegacyAjnVideoTitle(title: string, url = ""): string {
  const prefix = inferLegacyAjnVideoPrefix(title) || inferLegacyAjnVideoPrefix(url);
  if (!prefix) return title;

  const renamedTitle = renameLegacyAjnVideoFilename(title, prefix);
  if (renamedTitle !== title) return renamedTitle;

  const filename = url.split("#", 1)[0].split("?", 1)[0].split("/").filter(Boolean).pop() || "";
  const renamedFilename = renameLegacyAjnVideoFilename(filename, prefix);
  return renamedFilename !== filename ? renamedFilename : title;
}
