/**
 * Turns the text a user typed into the search box into a safe Archive Advanced Search clause for the TV News
 * collections. Two jobs:
 *  1. A pasted broadcast title ("The Five : FOXNEWSW : October 8, 2026 2:00pm-3:00pm PDT") is an exact-broadcast lookup.
 *     Archive TV identifiers are `<NETWORK>_<YYYYMMDD>_<HHMMSS UTC>_<Program>`, while titles show local time, so the
 *     start time is converted to UTC. Searching the title as caption text finds nothing (captions never contain the
 *     network code or the clock time).
 *  2. Any other text is escaped so characters such as `:` can never be read as a Lucene field operator. Unescaped, a
 *     colon makes Archive answer HTTP 200 with {"error":"a key-value pair is malformed"}.
 */

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** Hours to ADD to a local clock time to get UTC. Only zones Archive TV titles are known to use; unknown zones are not guessed. */
const UTC_OFFSET_HOURS: Record<string, number> = {
  UTC: 0, GMT: 0, EST: 5, EDT: 4, CST: 6, CDT: 5, MST: 7, MDT: 6, PST: 8, PDT: 7,
};

const TITLE_RE =
  /^\s*(.+?)\s*:\s*([A-Z][A-Z0-9-]{1,19})\s*:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)\b[^A-Za-z]*(?:\d{1,2}:\d{2}\s*(?:am|pm))?\s*([A-Z]{3,4})\s*$/i;

export interface BroadcastTitle { network: string; program: string; identifierPrefix: string }

/** Parses an Archive TV broadcast title into the identifier prefix of that broadcast, or null if it is not one. */
export function parseBroadcastTitle(raw: string): BroadcastTitle | null {
  const m = TITLE_RE.exec(raw);
  if (!m) return null;
  const month = MONTHS[m[3].toLowerCase()];
  const offset = UTC_OFFSET_HOURS[m[9].toUpperCase()];
  if (month === undefined || offset === undefined) return null;
  let hour = Number(m[6]);
  const minute = Number(m[7]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const pm = m[8].toLowerCase() === 'pm';
  hour = (hour % 12) + (pm ? 12 : 0);
  const day = Number(m[4]);
  const utc = new Date(Date.UTC(Number(m[5]), month, day, hour + offset, minute, 0));
  if (Number.isNaN(utc.getTime())) return null;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${utc.getUTCFullYear()}${pad(utc.getUTCMonth() + 1)}${pad(utc.getUTCDate())}_${pad(utc.getUTCHours())}${pad(utc.getUTCMinutes())}00`;
  const network = m[2].toUpperCase();
  return { network, program: m[1].trim(), identifierPrefix: `${network}_${stamp}_` };
}

/** Escapes Lucene operators that would change the meaning of plain text. Balanced "phrases" are kept; stray quotes are dropped. */
export function escapeLuceneText(raw: string): string {
  const quotes = (raw.match(/"/g) ?? []).length;
  const text = quotes % 2 === 0 ? raw : raw.replace(/"/g, ' ');
  let out = '';
  let inPhrase = false;
  for (const ch of text) {
    if (ch === '"') { inPhrase = !inPhrase; out += ch; continue; }
    if (inPhrase) { out += ch === '\\' ? '\\\\' : ch; continue; }
    out += /[:\\/^~()[\]{}!]/.test(ch) ? `\\${ch}` : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** The clause to AND into the TV News collection query, or null when there is nothing to search for. */
export function tvNewsQueryClause(raw: string | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const broadcast = parseBroadcastTitle(text);
  if (broadcast) return `identifier:${broadcast.identifierPrefix}*`;
  const escaped = escapeLuceneText(text);
  return escaped ? `(${escaped})` : null;
}
