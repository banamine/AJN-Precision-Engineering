import { parseSrt, pickCaptionFile } from "../../server/captions/captionCore.ts";
import { NEWS_NETWORKS } from "../../server/sources/archiveNews.ts";
import { createInfowarsRadioStore, INFOWARS_CHANNEL_ID, parseInfowarsUtcId } from "../../server/infowarsRadio.ts";
import { cueRows, serializeCsv } from "./csv.mjs";

export const DATA_FOLDER_CAP_BYTES = 50_000_000;
export const RETENTION_DAYS = 7;
export const DAILY_DAY_BUDGET_BYTES = Math.floor(DATA_FOLDER_CAP_BYTES / RETENTION_DAYS);
export const RADIO_ITEMS_PER_DAY = 9;
const configuredLagDays = process.env.TV_ADDITIONAL_LAG_DAYS === undefined
  ? 0
  : Number(process.env.TV_ADDITIONAL_LAG_DAYS);
if (!Number.isInteger(configuredLagDays) || configuredLagDays < 0 || configuredLagDays > 30) {
  throw new TypeError("TV_ADDITIONAL_LAG_DAYS must be an integer from 0 to 30.");
}
export const TV_ADDITIONAL_LAG_DAYS = configuredLagDays;
export const DAILY_REQUEST_CAP = 240;
export const MAX_SRT_BYTES = 8 * 1024 * 1024;

// Owner-approved TV networks. CNN/FOX/MSNBC/BBC codes match the real app
// registry; NTD is owner-approved but is not present in NEWS_NETWORKS.
export const TV_NETWORKS = Object.freeze([
  { channel: "CNN", codes: ["CNNW"] },
  { channel: "FOXNEWSW", codes: ["FOXNEWSW"] },
  { channel: "MSNOW", codes: ["MSNOW", "MSNOWW", "MSNBCW"] },
  { channel: "BBCNEWS", codes: ["BBCNEWS"] },
  { channel: "NTD", codes: ["NTDTV", "NTD"] },
]);
export const SOURCE_PRIORITY = Object.freeze([
  "archive-infowars-radio",
  "CNN",
  "FOXNEWSW",
  "MSNOW",
  "BBCNEWS",
  "NTD",
]);

const SUFFIX_RE = /\.(align|cc5|asr)\.srt$/i;
const privateFlag = (value) => value === true || String(value ?? "").toLowerCase() === "true";
const itemBlocked = (meta) => {
  const itemMeta = meta?.metadata ?? {};
  return privateFlag(itemMeta.private)
    || privateFlag(itemMeta.is_dark)
    || privateFlag(itemMeta["access-restricted-item"])
    || privateFlag(itemMeta.restricted);
};

export function parseBroadcastStartMs(identifier) {
  const match = /^([A-Za-z0-9]+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_|$)/.exec(String(identifier));
  if (!match) return null;
  const [, , yyyy, mm, dd, hh, min, ss] = match;
  const values = [yyyy, mm, dd, hh, min, ss].map(Number);
  const ms = Date.UTC(values[0], values[1] - 1, values[2], values[3], values[4], values[5]);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== values[0] || d.getUTCMonth() + 1 !== values[1] || d.getUTCDate() !== values[2]
    || d.getUTCHours() !== values[3] || d.getUTCMinutes() !== values[4] || d.getUTCSeconds() !== values[5]) return null;
  return ms;
}

function compactDay(dayUtc) {
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(dayUtc) ? Date.parse(`${dayUtc}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== dayUtc) {
    throw new TypeError("dayUtc must be a valid YYYY-MM-DD UTC date.");
  }
  return dayUtc.replaceAll("-", "");
}

function createRadioFetch(client) {
  return async (input) => {
    const url = new URL(String(input));
    const type = url.pathname === "/advancedsearch.php" ? "radio-search" : "radio-metadata";
    const result = await client.request(url, { type, accept: "application/json", maxBytes: 8 * 1024 * 1024 });
    if (!result.ok) return new Response(null, { status: result.status });
    const bytes = result.body;
    const jsonText = new TextDecoder().decode(bytes);
    bytes.fill(0);
    return new Response(jsonText, { status: result.status, headers: { "content-type": "application/json" } });
  };
}

async function searchNetwork(client, dayUtc, network) {
  const day = compactDay(dayUtc);
  const terms = network.codes.map((code) => `identifier:${code}_${day}_*`);
  const params = new URLSearchParams();
  params.set("q", `collection:tvnews AND (${terms.join(" OR ")})`);
  params.append("fl[]", "identifier");
  params.append("sort[]", "identifier asc");
  params.set("rows", "1000");
  params.set("output", "json");
  const ids = [];
  let expected = 0;
  for (let page = 1; page <= 10; page += 1) {
    params.set("page", String(page));
    const result = await client.json(`https://archive.org/advancedsearch.php?${params}`, { type: "tv-search" });
    if (!result.ok) throw new Error(`TV search failed with HTTP ${result.status}.`);
    const response = result.body?.response;
    const docs = response?.docs;
    expected = Number(response?.numFound);
    if (!Array.isArray(docs) || !Number.isSafeInteger(expected) || expected < 0) throw new Error("TV search response shape invalid.");
    for (const doc of docs) {
      const id = String(doc?.identifier ?? "");
      if (network.codes.some((code) => id.startsWith(`${code}_${day}_`))) ids.push(id);
    }
    if (ids.length >= expected || docs.length === 0) break;
  }
  const unique = [...new Set(ids)].sort();
  if (unique.length !== expected) throw new Error("TV search pagination incomplete; no output will be published.");
  return { ids: unique, numFound: expected };
}

async function getMetadata(client, id, type) {
  const result = await client.json(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
    type,
    accept: "application/json",
    maxBytes: 8 * 1024 * 1024,
  });
  return result.ok && result.body && typeof result.body === "object"
    ? { status: result.status, metadata: result.body }
    : { status: result.status, metadata: null };
}

function chooseCaption(id, metadata) {
  const files = Array.isArray(metadata?.files) ? metadata.files : [];
  if (itemBlocked(metadata)) return { skip: "item_not_public" };
  const allCaptionFiles = files.filter((file) => SUFFIX_RE.test(String(file?.name ?? "")));
  const publicFiles = files.filter((file) => !privateFlag(file?.private));
  const selected = pickCaptionFile(id, publicFiles);
  if (selected) return { selected, publicFileCount: allCaptionFiles.filter((file) => !privateFlag(file.private)).length };
  return {
    skip: allCaptionFiles.length ? "private_caption_only" : "caption_not_listed",
    publicFileCount: 0,
  };
}

export async function collectDay({
  client,
  dayUtc,
  networks = TV_NETWORKS,
  radioLimit = RADIO_ITEMS_PER_DAY,
  dayBudgetBytes = DAILY_DAY_BUDGET_BYTES,
  radioStoreFactory = createInfowarsRadioStore,
} = {}) {
  if (!client || typeof client.json !== "function" || typeof client.text !== "function") throw new TypeError("A paced ArchiveClient is required.");
  compactDay(dayUtc);
  if (!Number.isInteger(radioLimit) || radioLimit < 0 || radioLimit > 12) throw new TypeError("radioLimit must be 0..12.");
  if (!Number.isSafeInteger(dayBudgetBytes) || dayBudgetBytes < 1) throw new TypeError("dayBudgetBytes must be positive.");

  const stats = {
    dayUtc,
    tvSearches: 0,
    tvItemsFound: 0,
    tvMetadataSuccess: 0,
    radioCandidateCount: 0,
    radioSchedulePrograms: 0,
    radioScheduleSeconds: 0,
    radioMetadataRequests: 0,
    radioLimit,
    radioSelectedForArchive: 0,
    radioItemsOutsideLimit: 0,
    itemsOk: 0,
    itemsSkipped: 0,
    rows: 0,
    csvBytes: 0,
    reasonCounts: {},
    perNetwork: [],
  };
  const countReason = (reason, count = 1) => {
    stats.reasonCounts[reason] = (stats.reasonCounts[reason] ?? 0) + count;
    stats.itemsSkipped += count;
  };
  const candidates = [];

  const registeredCodes = new Set(NEWS_NETWORKS.flatMap(([codes]) => codes.split("|").map((x) => x.trim().toUpperCase())));
  for (const network of networks) {
    const codes = network.codes.map((code) => String(code).toUpperCase());
    if (network.channel !== "NTD" && !codes.some((code) => registeredCodes.has(code))) {
      throw new Error(`Network ${network.channel} is not admitted by the app's news registry.`);
    }
    const search = await searchNetwork(client, dayUtc, { ...network, codes });
    stats.tvSearches += 1;
    stats.tvItemsFound += search.ids.length;
    const perNetwork = { channel: network.channel, found: search.ids.length, metadataSuccess: 0, eligible: 0, publicAlign: 0, privateAlign: 0, publicCc5: 0, privateCc5: 0, publicAsr: 0, privateAsr: 0 };
    for (const id of search.ids) {
      const result = await getMetadata(client, id, "tv-metadata");
      if (!result.metadata) {
        countReason(`tv_metadata_http_${result.status}`);
        continue;
      }
      stats.tvMetadataSuccess += 1;
      perNetwork.metadataSuccess += 1;
      const files = Array.isArray(result.metadata.files) ? result.metadata.files : [];
      for (const file of files) {
        const match = SUFFIX_RE.exec(String(file?.name ?? ""));
        if (!match) continue;
        const suffix = match[1].toLowerCase();
        const key = `${privateFlag(file.private) ? "private" : "public"}${suffix === "align" ? "Align" : suffix === "cc5" ? "Cc5" : "Asr"}`;
        perNetwork[key] += 1;
      }
      const choice = chooseCaption(id, result.metadata);
      if (!choice.selected) {
        countReason(`tv_${choice.skip}`);
        continue;
      }
      perNetwork.eligible += 1;
      candidates.push({
        sourceKind: "tv",
        channel: network.channel,
        genre: "News",
        id,
        itemStartMs: parseBroadcastStartMs(id),
        metadata: result.metadata,
        captionKind: choice.selected.kind,
        captionFile: choice.selected.file,
      });
    }
    stats.perNetwork.push(perNetwork);
  }

  const dayStartMs = Date.parse(`${dayUtc}T12:00:00.000Z`);
  const radioStore = radioStoreFactory({
    fetchImpl: createRadioFetch(client),
    now: () => dayStartMs,
    cacheDir: null,
  });
  const radioPrograms = await radioStore.buildChannel("audio", new Date(dayStartMs));
  const radioDiagnostics = radioStore.getDiagnostics();
  stats.radioCandidateCount = radioDiagnostics.candidateCount;
  stats.radioSchedulePrograms = radioPrograms.length;
  stats.radioScheduleSeconds = radioDiagnostics.scheduleSeconds;
  stats.radioMetadataRequests = radioDiagnostics.metadataRequests;
  if (radioDiagnostics.skippedCount) countReason("radio_schedule_unresolved", radioDiagnostics.skippedCount);
  stats.radioItemsOutsideLimit = Math.max(0, radioPrograms.length - radioLimit);
  if (stats.radioItemsOutsideLimit) countReason("radio_limit", stats.radioItemsOutsideLimit);
  const selectedRadio = radioPrograms.slice(0, radioLimit);
  for (const program of selectedRadio) {
    const id = String(program.sourceId ?? program.id ?? "");
    const metadata = radioStore.cachedItemMetadata(id);
    const file = metadata?.files?.find((entry) => String(entry.name ?? "") === `${id}.asr.srt`);
    if (!metadata || itemBlocked({ metadata })) {
      countReason("radio_item_not_public");
      continue;
    }
    if (!file) {
      countReason("radio_asr_not_listed");
      continue;
    }
    if (privateFlag(file.private)) {
      countReason("radio_asr_private");
      continue;
    }
    stats.radioSelectedForArchive += 1;
    candidates.push({
      sourceKind: "radio",
      channel: INFOWARS_CHANNEL_ID,
      genre: "Talk Radio",
      id,
      itemStartMs: parseInfowarsUtcId(id),
      metadata,
      captionKind: "asr",
      captionFile: file.name,
      durationSeconds: Number(program.metadata?.durationSeconds) || null,
    });
  }

  // Stable priority: owner-selected radio first, then fixed network order and UTC item time.
  candidates.sort((a, b) => SOURCE_PRIORITY.indexOf(a.channel) - SOURCE_PRIORITY.indexOf(b.channel)
    || (a.itemStartMs ?? 0) - (b.itemStartMs ?? 0)
    || a.id.localeCompare(b.id));

  let rows = [];
  let budgetClosed = false;
  const headerBytes = serializeCsv([]).byteLength;
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index];
    if (budgetClosed) {
      countReason("day_budget");
      continue;
    }
    const url = `https://archive.org/download/${encodeURIComponent(item.id)}/${encodeURIComponent(item.captionFile)}`;
    const fetched = await client.text(url, { type: item.sourceKind === "radio" ? "radio-asr" : "tv-srt", maxBytes: MAX_SRT_BYTES });
    if (!fetched.ok) {
      countReason(`${item.sourceKind}_caption_http_${fetched.status}`);
      continue;
    }
    let raw = fetched.body;
    const cues = parseSrt(raw);
    raw = "";
    fetched.body = "";
    const itemRows = cueRows({
      dayUtc,
      sourceKind: item.sourceKind,
      channel: item.channel,
      genre: item.genre,
      program: item.id,
      itemId: item.id,
      itemStartMs: item.itemStartMs,
      captionKind: item.captionKind,
      cues,
    });
    const candidateRows = [...rows, ...itemRows];
    const candidateBytes = serializeCsv(candidateRows);
    if (candidateBytes.byteLength > dayBudgetBytes) {
      candidateBytes.fill(0);
      countReason("day_budget");
      budgetClosed = true;
      cues.length = 0;
      itemRows.length = 0;
      continue;
    }
    candidateBytes.fill(0);
    rows.push(...itemRows);
    stats.itemsOk += 1;
    stats.rows += itemRows.length;
    cues.length = 0;
    itemRows.length = 0;
  }
  rows.sort((a, b) => a.source_kind.localeCompare(b.source_kind)
    || a.channel.localeCompare(b.channel)
    || a.start_utc.localeCompare(b.start_utc)
    || a.item_id.localeCompare(b.item_id)
    || Number(a.start_s) - Number(b.start_s));
  const csvBytes = serializeCsv(rows);
  if (csvBytes.byteLength > dayBudgetBytes || csvBytes.byteLength < headerBytes) throw new Error("Day budget invariant failed.");
  stats.csvBytes = csvBytes.byteLength;
  return {
    dayUtc,
    rows,
    csvBytes,
    stats,
    radioDiagnostics: {
      candidateCount: radioDiagnostics.candidateCount,
      schedulePrograms: radioDiagnostics.resolvedItems,
      scheduleSeconds: radioDiagnostics.scheduleSeconds,
      metadataRequests: radioDiagnostics.metadataRequests,
      skipped: radioDiagnostics.skippedCount,
    },
  };
}
