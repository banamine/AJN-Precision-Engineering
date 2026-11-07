import { decodeField } from './decode';
import { checkTitleZoneLabel, classifyDate } from './date';
import { parseArticleUrl, parseImageUrl, urlKey } from './url';
import type { Diagnostic, NormalizeBatchResult, NormalizedItem, RawItem, SourceConfig } from './types';

export type NormalizeResult =
  | { ok: true; item: NormalizedItem }
  | { ok: false; reason: string; diagnostics: readonly Diagnostic[] };

function hash(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const pick = (raw: RawItem, ...keys: string[]): unknown => {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

function isNormalized(x: unknown): boolean {
  return typeof x === 'object' && x !== null && (x as { normalized?: unknown }).normalized === true;
}

/** Raw -> normalized. Throws if given an already-normalized record (no re-decoding, ever). */
export function normalizeRaw(raw: RawItem, config: SourceConfig): NormalizeResult {
  if (isNormalized(raw)) throw new Error('normalizeRaw received an already-normalized record');
  const diagnostics: Diagnostic[] = [];
  const addAll = (field: Diagnostic['field'], ds: Diagnostic[]): void => {
    for (const d of ds) diagnostics.push({ ...d, field });
  };

  const t = decodeField(pick(raw, 'title'), config.fields.title);
  addAll('title', t.diagnostics);
  const s = decodeField(pick(raw, 'summary', 'description'), config.fields.summary);
  addAll('summary', s.diagnostics);

  const rawUrl = pick(raw, 'url', 'link');
  const parsed = parseArticleUrl(rawUrl);
  if (!parsed.ok) {
    diagnostics.push({ code: `url-${parsed.reason}`, field: 'url' });
    return { ok: false, reason: `url-${parsed.reason}`, diagnostics };
  }

  const pub = classifyDate(pick(raw, 'publishedAt', 'pubDate'));
  const bc = classifyDate(pick(raw, 'broadcastAt'));
  const fe = classifyDate(pick(raw, 'fetchedAt'));
  if (pub.status !== 'valid') diagnostics.push({ code: `date-${pub.status}`, field: 'date' });
  const zone = checkTitleZoneLabel(t.text);
  if (zone) diagnostics.push({ code: 'title-zone-label', field: 'title', detail: zone });

  const key = urlKey(parsed.url, config.trackingParams);
  const sourceName = typeof pick(raw, 'sourceName', 'source') === 'string' ? String(pick(raw, 'sourceName', 'source')) : config.sourceId;
  const img = pick(raw, 'imageUrl', 'image');
  const imageUrl = parseImageUrl(img);
  if (img !== undefined && imageUrl === null) diagnostics.push({ code: 'image-rejected', field: 'url' });

  const item: NormalizedItem = {
    schemaVersion: 1,
    normalized: true,
    id: hash(`${config.sourceId}|${key}`),
    title: t.text || null,
    summary: s.text || null,
    sourceName,
    articleUrl: String(rawUrl),
    navigationUrl: parsed.url,
    urlKey: key,
    imageUrl,
    publishedAt: pub.iso ?? null,
    broadcastAt: bc.iso ?? null,
    fetchedAt: fe.iso ?? null,
    dateStatus: pub.status,
    broadcastStatus: bc.status,
    raw: { ...raw },
    diagnostics,
  };
  return { ok: true, item };
}

export function normalizeBatch(raws: readonly RawItem[], config: SourceConfig): NormalizeBatchResult {
  const items: NormalizedItem[] = [];
  const withheld: { item: NormalizedItem; reason: string }[] = [];
  let rejected = 0;
  for (const raw of raws) {
    const r = normalizeRaw(raw, config);
    if (!r.ok) {
      rejected++;
      continue;
    }
    if (r.item.title === null) withheld.push({ item: r.item, reason: 'title-withheld' });
    else items.push(r.item);
  }
  return {
    items,
    withheld,
    counts: { total: raws.length, valid: items.length, withheld: withheld.length, rejected },
  };
}

/** Reads a normalized record as-is. Never decodes. */
export function readNormalized(x: unknown): NormalizedItem {
  if (!isNormalized(x) || (x as NormalizedItem).schemaVersion !== 1) throw new Error('not a normalized record');
  return x as NormalizedItem;
}
