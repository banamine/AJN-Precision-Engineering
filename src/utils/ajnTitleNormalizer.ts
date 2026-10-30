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

const ENTITY_NAMES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeDisplayEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] !== "#") return ENTITY_NAMES[body.toLowerCase()] ?? entity;
    const codePoint = body[1]?.toLowerCase() === "x"
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return entity;
    }
    return String.fromCodePoint(codePoint);
  });
}

const RELEASE_GROUP = /\[(?=[^\]]*(?:\b(?:eztv|rarbg|ettv|yify|yts|tgx|fgt|ion10|x264|x265|hevc|bluray|dvdrip|webrip|web[- ]?dl|dvd|aac|ac3|10[- ]?bit|[25]\s*[.]?\s*0)\b))[^\]]*\]|-(?:RARBG|EZTV|ETTV|YIFY|YTS|TGx|FGT|ION10|NTb|PSA|RMTeam|MeGusta|KOGi|CtrlHD|DIMENSION|LOL)\b/gi;
const TECHNICAL_TAG = /\b(?:\d{3,4}p|x264|x265|hevc|10bit|aac\d?|ac3|dvdrip|web[- ]?dl|webrip|bluray|brrip|amzn|hdtv|ntsc|pal)\b/gi;
const PRESENTATION_TAG = /\b(?:AI\s+)?upscal(?:e|ed)\b|\bremaster(?:ed)?\b|\bVHS\b|\bDVD\s+ISO\b|\bMKV\b|\bwith\s+subtitles\b/gi;

/**
 * Cleans a title only at a display boundary. It never changes schedule IDs,
 * Archive identifiers, filenames, URLs, or the source Program object.
 *
 * Ordered rules:
 * 1. NFKC + known HTML entities (compatibility glyphs become readable letters).
 * 2. Remove only explicit filename/source markers, release groups and codec tags.
 * 3. Normalize separators and episode codes while preserving years, parts,
 *    punctuation, and acronyms.
 * 4. Collapse whitespace and trim dangling separators.
 *
 * All-caps titles and generic "(1)" suffixes are intentionally retained:
 * without metadata they may be proper names or identity-bearing distinctions.
 */
export function cleanAjnDisplayTitle(input: string): string {
  if (typeof input !== "string" || !input.trim()) return "";

  let value = input.normalize("NFKC");
  try {
    value = decodeURIComponent(value);
  } catch {
    // Malformed percent escapes are preserved rather than guessed.
  }
  value = decodeDisplayEntities(value);
  const hadEllipsis = value.includes("...");

  value = value
    .replace(/^\d{8}\s+-\s+[A-Za-z0-9_-]{8,}\s+-\s*/, "")
    .replace(/\.(?:ia\.)?(?:mp4|m4v|mkv|webm|avi|mpeg?|mp3|ogv|ogg|flac)$/i, "")
    .replace(/\.ia$/i, "")
    .replace(/\s+ia$/, "")
    .replace(/\{imdb-tt\d+\}/gi, " ")
    .replace(RELEASE_GROUP, " ")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\b(?:archive\.org|freedownloadvideo\.net|swap\.com)\b/gi, " ")
    .replace(/\(\s*[-–—|.]*\s*\)/g, " ")
    .replace(/\[\s*[-–—|.]*\s*\]/g, " ")
    .replace(/\[\s*[\d\s.]+\s*\]/g, " ")
    .replace(/\b(?:NTSC|PAL)\s*[.]?\s*DVD\b/gi, " ")
    .replace(/\.DVD\b/gi, " ")
    .replace(TECHNICAL_TAG, " ")
    .replace(PRESENTATION_TAG, " ")
    .replace(/\(\s*[-–—|.]*\s*\)/g, " ")
    .replace(/_/g, " ")
    .replace(/\(\s*\)/g, " ");

  // Repeated show prefixes in "show / show episode" export labels are display
  // noise; remove the first copy only when the next half begins with it exactly.
  const slash = value.indexOf(" / ");
  if (slash > 0) {
    const prefix = value.slice(0, slash).trim();
    const remainder = value.slice(slash + 3).trimStart();
    if (prefix.length >= 3 && remainder.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) {
      value = remainder;
    }
  }

  // Dots are separators only in dot-joined filename-style titles. Initials
  // such as T.V. and punctuation such as Mr. remain intact.
  if (!hadEllipsis) value = value.replace(/\.{2,}/g, ".");
  const dotParts = value.split(".").filter((part) => part.trim().length > 0);
  if (
    !hadEllipsis &&
    dotParts.length >= 4 &&
    dotParts.every((part, index) => part.trim().length >= 2 || (index === 0 && part.trim().length === 1))
  ) {
    value = dotParts.join(" ");
  }

  // Normalize explicit episode notation before trimming punctuation.
  value = value
    .replace(/\bseason\s*0*(\d{1,2})\s*episode\s*0*(\d{1,3})\b/gi, (_m, season: string, episode: string) =>
      `S${season.padStart(2, "0")}E${episode.padStart(2, "0")}`)
    .replace(/\bS[\s._-]*0*(\d{1,2})[\s._-]*E(?:P)?[\s._-]*0*(\d{1,3})\b/gi, (_m, season: string, episode: string) =>
      `S${season.padStart(2, "0")}E${episode.padStart(2, "0")}`)
    .replace(/\b(\d{1,2})x(\d{1,3})\b/gi, (_m, season: string, episode: string) =>
      `S${season.padStart(2, "0")}E${episode.padStart(2, "0")}`)
    // Numbered track prefixes are removed only when clearly separated.
    .replace(/^\s*(?:(?:\d{1,2}\s+-\s+){1,2}|\d{1,3}\.\s+)/, "");

  // A trailing bare year is display-normalized; dates and existing parentheses stay.
  const trailingYear = /\s+((?:19|20)\d{2})\s*$/.exec(value);
  const beforeYear = trailingYear ? value.slice(0, trailingYear.index) : "";
  const month = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const isDate = new RegExp(`(?:\\b\\d{1,2}\\s+${month}|\\b${month}\\s+\\d{1,2},?)$`, "i").test(beforeYear);
  if (trailingYear && !isDate && !beforeYear.endsWith(")")) {
    value = `${beforeYear} (${trailingYear[1]})`;
  }
  return value
    .replace(/\s+([,;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .replace(/[-–—]+\s*$/g, "")
    .trim()
    .replace(/^[|:]+|[|:]+$/g, "")
    .trim();
}
