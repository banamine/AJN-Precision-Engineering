export const CSV_COLUMNS = Object.freeze([
  "day_utc",
  "start_utc",
  "start_s",
  "end_s",
  "source_kind",
  "channel",
  "program",
  "item_id",
  "item_url",
  "caption_kind",
  "machine_generated",
  "genre",
  "text",
]);

function finiteTime(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function decimal(value) {
  return Number(value.toFixed(3)).toString();
}

/** Groups consecutive cues without dropping or rewriting any cue text. */
export function mergeCues(cues, maxWindowSeconds = 30) {
  const sorted = cues
    .map((cue, index) => ({ ...cue, _index: index }))
    .filter((cue) => finiteTime(cue.start) && finiteTime(cue.end) && cue.end >= cue.start && typeof cue.text === "string")
    .sort((a, b) => a.start - b.start || a.end - b.end || a._index - b._index);
  const groups = [];
  let current = null;
  for (const cue of sorted) {
    const fits = current
      && cue.start >= current.start
      && cue.start - current.start < maxWindowSeconds
      && cue.end - current.start <= maxWindowSeconds;
    if (!fits) {
      current = { start: cue.start, end: cue.end, texts: [cue.text] };
      groups.push(current);
    } else {
      current.end = Math.max(current.end, cue.end);
      current.texts.push(cue.text);
    }
  }
  return groups.map((group) => ({
    start: group.start,
    end: group.end,
    text: group.texts.join("\n"),
  }));
}

function startUtc(itemStartMs, seconds) {
  if (!Number.isFinite(itemStartMs) || !finiteTime(seconds)) return "";
  const date = new Date(itemStartMs + Math.round(seconds * 1000));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export function cueRows({
  dayUtc,
  sourceKind,
  channel,
  genre,
  program,
  itemId,
  itemStartMs,
  captionKind,
  cues,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayUtc)) throw new TypeError("dayUtc must be YYYY-MM-DD.");
  if (!["tv", "radio"].includes(sourceKind)) throw new TypeError("sourceKind must be tv or radio.");
  if (!["aligned", "broadcast-cc", "asr"].includes(captionKind)) throw new TypeError("captionKind is invalid.");
  const machineGenerated = captionKind === "asr" ? "yes" : "no";
  return mergeCues(cues).map((cue) => ({
    day_utc: dayUtc,
    start_utc: startUtc(itemStartMs, cue.start),
    start_s: decimal(cue.start),
    end_s: decimal(cue.end),
    source_kind: sourceKind,
    channel,
    program,
    item_id: itemId,
    item_url: `https://archive.org/details/${encodeURIComponent(itemId)}`,
    caption_kind: captionKind,
    machine_generated: machineGenerated,
    genre,
    text: cue.text,
  }));
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC4180 records with a UTF-8 BOM and CRLF record separators. */
export function serializeRecords(columns, rows) {
  const data = [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))];
  const csv = data.map((record) => record.map(escapeCsv).join(",")).join("\r\n") + "\r\n";
  return Buffer.from(`\uFEFF${csv}`, "utf8");
}

export function serializeCsv(rows) {
  return serializeRecords(CSV_COLUMNS, rows);
}

/** Parse RFC4180 CSV, including quoted commas and embedded line breaks. */
export function parseCsv(bufferOrText) {
  const text = Buffer.isBuffer(bufferOrText) ? bufferOrText.toString("utf8") : String(bufferOrText);
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\r" && input[i + 1] === "\n") {
      row.push(field); records.push(row); row = []; field = ""; i += 1;
    } else if (char === "\n" || char === "\r") {
      row.push(field); records.push(row); row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("Malformed CSV: unterminated quoted field.");
  if (field.length || row.length) { row.push(field); records.push(row); }
  if (!records.length) return [];
  const header = records.shift();
  return records.filter((record) => record.length === header.length).map((record) =>
    Object.fromEntries(header.map((name, i) => [name, record[i]])),
  );
}
