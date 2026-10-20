// One serial Archive request client for the daily tool and bounded probes.
// Every manual redirect hop is a counted physical start. No retry path exists.
const ARCHIVE_HOST = /(^|\.)archive\.org$/i;
export const MIN_START_GAP_MS = 2000;
export const JOB_REQUEST_CAP = 60;
export const DAILY_REQUEST_CAP = 240;
export const USER_AGENT = "AJN-Precision-Engineering/captions-daily-csv/1.0 (public metadata and captions; owner-authorized)";

export class ArchiveStopError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ArchiveStopError";
    this.code = code;
    this.details = details;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBounded(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      value.fill(0);
      for (const chunk of chunks) chunk.fill(0);
      await reader.cancel().catch(() => {});
      throw new ArchiveStopError("body-cap", "Archive response exceeded the in-memory byte cap.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
    chunk.fill(0);
  }
  return out;
}

function retryAfterSeconds(value) {
  const header = String(value ?? "").trim();
  if (!header) return null;
  if (/^\d+(?:\.\d+)?$/.test(header)) return Math.max(0, Math.ceil(Number(header)));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

export class ArchiveClient {
  constructor({
    fetchImpl = globalThis.fetch,
    maxRequests = JOB_REQUEST_CAP,
    minGapMs = MIN_START_GAP_MS,
    maxRedirects = 4,
    maxBodyBytes = 8 * 1024 * 1024,
    userAgent = USER_AGENT,
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("ArchiveClient requires fetch.");
    if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new TypeError("maxRequests must be a positive integer.");
    this.fetchImpl = fetchImpl;
    this.maxRequests = Math.min(maxRequests, DAILY_REQUEST_CAP);
    this.minGapMs = minGapMs;
    this.maxRedirects = maxRedirects;
    this.maxBodyBytes = maxBodyBytes;
    this.userAgent = userAgent;
    this.requests = [];
    this.starts = [];
    this.lastStart = 0;
    this.consecutive5xx = 0;
    this.stopped = null;
    this.phase = "unassigned";
    this.phaseLimit = JOB_REQUEST_CAP;
    this.phaseStarts = 0;
    this.createdAt = Date.now();
  }

  beginPhase(name, maxStarts = JOB_REQUEST_CAP) {
    if (!Number.isInteger(maxStarts) || maxStarts < 1) throw new TypeError("phase request cap must be positive.");
    this.phase = name;
    this.phaseLimit = Math.min(maxStarts, this.maxRequests);
    this.phaseStarts = 0;
  }

  stop(code, message, details = {}) {
    this.stopped ??= code;
    throw new ArchiveStopError(this.stopped, message, details);
  }

  async request(input, {
    type = "unknown",
    accept = "*/*",
    maxBytes = this.maxBodyBytes,
  } = {}) {
    if (this.stopped) throw new ArchiveStopError(this.stopped, "Archive run is stopped.");
    let current;
    try { current = new URL(input); } catch { this.stop("invalid-url", "Invalid Archive URL."); }
    const statusChain = [];

    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      if (this.requests.length >= this.maxRequests) this.stop("request-budget", "Archive request budget reached.");
      if (this.phaseStarts >= this.phaseLimit) this.stop("phase-budget", "Archive phase request budget reached.");
      if (current.protocol !== "https:" || !ARCHIVE_HOST.test(current.hostname)) {
        this.stop("host-rejected", "Only HTTPS Archive.org hosts are permitted.");
      }
      const waitMs = Math.max(0, this.lastStart + this.minGapMs - Date.now());
      if (waitMs > 0) await delay(waitMs);

      let pending;
      let startAt;
      const requestIndex = this.requests.length + 1;
      try {
        // NET_GUARD is preloaded for live runs. Calling fetch first lets its
        // synchronous wrapper observe the physical start before we stamp it.
        pending = this.fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          headers: { "User-Agent": this.userAgent, Accept: accept },
          signal: AbortSignal.timeout(30_000),
        });
        startAt = Date.now();
        this.lastStart = startAt;
        this.starts.push(startAt);
        this.phaseStarts += 1;
        const response = await pending;
        const status = response.status;
        statusChain.push(status);
        const contentLengthHeader = response.headers.get("content-length");
        const contentLength = /^\d+$/.test(contentLengthHeader ?? "") ? Number(contentLengthHeader) : null;
        const retryHeader = response.headers.get("retry-after");
        const rec = {
          index: requestIndex,
          phase: this.phase,
          type,
          host: current.hostname.toLowerCase(),
          status,
          contentLength,
          bytesRead: 0,
          elapsedMs: Date.now() - startAt,
          redirectHop: hop,
          retryAfterSeconds: retryHeader !== null ? retryAfterSeconds(retryHeader) : null,
        };
        this.requests.push(rec);

        if (retryHeader !== null) {
          await response.body?.cancel().catch(() => {});
          this.stop("retry-after", "Archive sent Retry-After; stopping without waiting or retrying.", { seconds: rec.retryAfterSeconds });
        }
        if (status === 403 || status === 429) {
          await response.body?.cancel().catch(() => {});
          this.stop(`http-${status}`, `Archive HTTP ${status}; stopping without retry.`);
        }
        if (status >= 500 && status <= 599) {
          this.consecutive5xx += 1;
          await response.body?.cancel().catch(() => {});
          if (this.consecutive5xx >= 2) this.stop("two-5xx", "Two consecutive Archive 5xx responses; stopping.");
          return { ok: false, status, statusChain, bytes: 0, contentLength, body: null };
        }
        this.consecutive5xx = 0;

        if (status >= 300 && status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel().catch(() => {});
          if (!location) this.stop("redirect-without-location", "Archive redirect had no Location.");
          if (hop === this.maxRedirects) this.stop("redirect-limit", "Archive redirect limit reached.");
          current = new URL(location, current);
          continue;
        }

        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          return { ok: false, status, statusChain, bytes: 0, contentLength, body: null };
        }

        let bytes;
        try { bytes = await readBounded(response, maxBytes); }
        catch (error) {
          if (error instanceof ArchiveStopError) this.stop(error.code, error.message);
          this.stop("body-read-error", "Unable to read bounded Archive response.");
        }
        rec.bytesRead = bytes.byteLength;
        return { ok: true, status, statusChain, bytes: bytes.byteLength, contentLength, body: bytes };
      } catch (error) {
        if (error instanceof ArchiveStopError) throw error;
        const rec = {
          index: requestIndex,
          phase: this.phase,
          type,
          host: current.hostname.toLowerCase(),
          status: 0,
          contentLength: null,
          bytesRead: 0,
          elapsedMs: startAt ? Date.now() - startAt : 0,
          redirectHop: hop,
          retryAfterSeconds: null,
        };
        if (this.requests.at(-1)?.index !== requestIndex) this.requests.push(rec);
        this.stop("network-error", "Archive request failed; stopping without retry.");
      }
    }
    this.stop("redirect-limit", "Archive redirect limit reached.");
  }

  async json(url, options = {}) {
    const result = await this.request(url, { ...options, accept: "application/json", maxBytes: options.maxBytes ?? 8 * 1024 * 1024 });
    if (!result.ok) return result;
    try {
      let text = new TextDecoder().decode(result.body);
      const body = JSON.parse(text);
      text = "";
      result.body.fill(0);
      result.body = null;
      return { ...result, body };
    } catch {
      result.body.fill(0);
      this.stop("invalid-json", "Archive JSON response was invalid.");
    }
  }

  async text(url, options = {}) {
    const result = await this.request(url, { ...options, accept: "text/plain, application/x-subrip, */*", maxBytes: options.maxBytes ?? 8 * 1024 * 1024 });
    if (!result.ok) return result;
    try {
      const body = new TextDecoder().decode(result.body);
      result.body.fill(0);
      result.body = null;
      return { ...result, body };
    } catch {
      result.body.fill(0);
      this.stop("invalid-text", "Archive text response was invalid.");
    }
  }

  summary() {
    const gaps = this.starts.slice(1).map((start, i) => start - this.starts[i]);
    const byType = {};
    const byStatus = {};
    for (const row of this.requests) {
      byType[row.type] = (byType[row.type] ?? 0) + 1;
      const key = String(row.status);
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
    const bytesReadByType = {};
    const elapsedMsByType = {};
    const startsByPhase = {};
    for (const row of this.requests) {
      bytesReadByType[row.type] = (bytesReadByType[row.type] ?? 0) + row.bytesRead;
      elapsedMsByType[row.type] = (elapsedMsByType[row.type] ?? 0) + row.elapsedMs;
      startsByPhase[row.phase] = (startsByPhase[row.phase] ?? 0) + 1;
    }
    return {
      physicalStarts: this.requests.length,
      elapsedMs: Date.now() - this.createdAt,
      requestCap: this.maxRequests,
      minimumConfiguredGapMs: this.minGapMs,
      measuredMinimumGapMs: gaps.length ? Math.min(...gaps) : null,
      redirects: this.requests.filter((r) => r.status >= 300 && r.status < 400).length,
      byType,
      byStatus,
      bytesReadByType,
      elapsedMsByType,
      startsByPhase,
      stopped: this.stopped,
    };
  }
}
