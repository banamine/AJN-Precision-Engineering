import express from "express";

const router = express.Router();

const ARCHIVE_ORIGIN = "https://archive.org";
const USER_AGENT = "AJN-Media-Console/ArchiveProxy";
const MAX_REDIRECTS = 5;

function isSafeArchivePath(raw: string): boolean {
  if (!raw || !raw.startsWith("/")) return false;
  if (raw.includes("\0")) return false;
  if (/^\/\//.test(raw)) return false;
  return (
    raw.startsWith("/download/") ||
    /^\/\d+\/items\//.test(raw)
  );
}

function normalizeArchivePath(raw: string): string {
  // Preserve the query string exactly; it may contain Archive clipping parameters.
  const q = raw.indexOf("?");
  const pathname = q >= 0 ? raw.slice(0, q) : raw;
  const search = q >= 0 ? raw.slice(q) : "";

  if (pathname.startsWith("/download/")) {
    return pathname + search;
  }

  const match = pathname.match(/^\/\d+\/items\/([^/]+)\/(.+)$/);
  if (!match) throw new Error("Invalid Archive item path");

  const identifier = decodeURIComponent(match[1]);
  const filename = match[2]
    .split("/")
    .map((part) => encodeURIComponent(decodeURIComponent(part)))
    .join("/");

  return `/download/${encodeURIComponent(identifier)}/${filename}${search}`;
}

function isMediaContentType(value: string | null): boolean {
  if (!value) return false;
  const type = value.split(";")[0].trim().toLowerCase();
  return type.startsWith("video/") ||
    type.startsWith("audio/") ||
    type === "application/octet-stream";
}

async function fetchArchive(url: string, init: RequestInit): Promise<Response> {
  let current = url;

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
    const response = await fetch(current, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.headers || {}),
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
      },
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) return response;

    const next = new URL(location, current);
    if (next.protocol !== "https:") {
      throw new Error("Archive redirect rejected: non-HTTPS target");
    }
    if (!/^(?:archive\.org|ia\d+\.us\.archive\.org)$/.test(next.hostname)) {
      throw new Error(`Archive redirect rejected: ${next.hostname}`);
    }
    current = next.toString();
  }

  throw new Error("Archive redirect limit exceeded");
}

router.get("/api/archive/proxy", async (req, res) => {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";

  if (!isSafeArchivePath(rawPath)) {
    res.status(400).json({
      success: false,
      error: "Invalid Archive path. Expected /download/{identifier}/{filename} or /{node}/items/{identifier}/{filename}."
    });
    return;
  }

  let normalizedPath: string;
  try {
    normalizedPath = normalizeArchivePath(rawPath);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
    return;
  }

  const upstreamUrl = new URL(normalizedPath, ARCHIVE_ORIGIN).toString();
  const incomingRange = req.headers.range;

  const headers: Record<string, string> = {
    "Accept": "*/*",
    "User-Agent": USER_AGENT,
  };

  // Forward Range verbatim. No artificial chunking or 2 MiB clamp.
  if (incomingRange) headers.Range = incomingRange;

  try {
    const upstream = await fetchArchive(upstreamUrl, { method: "GET", headers });

    const contentType = upstream.headers.get("content-type");
    const isErrorDocument =
      contentType?.toLowerCase().includes("text/html") ||
      contentType?.toLowerCase().includes("application/json");

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status);
      res.setHeader("Content-Type", contentType || "text/plain; charset=utf-8");
      const body = await upstream.text();
      res.send(body.slice(0, 4096));
      return;
    }

    if (isErrorDocument || !isMediaContentType(contentType)) {
      console.error(`[ArchiveProxy] Refusing non-media upstream response: ${contentType || "missing"}`);
      res.status(502).json({
        success: false,
        error: "Archive upstream did not return playable media",
        upstreamStatus: upstream.status,
        contentType: contentType || null,
      });
      return;
    }

    // Tell the browser exactly what Archive returned. Never manufacture 206.
    res.status(upstream.status);

    const passthroughHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified",
      "cache-control",
    ];

    for (const name of passthroughHeaders) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    res.setHeader("X-AJN-Archive-Proxy", "range-native");

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    let bytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (!res.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
      res.end();
      console.log(
        `[ArchiveProxy] ${upstream.status} ${incomingRange || "full"} ` +
        `${bytes} bytes ${contentType || "unknown"} ${normalizedPath}`
      );
    } catch (streamError: any) {
      console.error(`[ArchiveProxy] Stream failure after ${bytes} bytes:`, streamError.message);
      if (!res.headersSent) res.status(502);
      res.end();
    }
  } catch (error: any) {
    console.error("[ArchiveProxy] Upstream failure:", error.message);
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        error: "Archive proxy upstream failure",
        detail: error.message,
      });
    }
  }
});

export default router;
