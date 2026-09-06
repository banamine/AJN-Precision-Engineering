import express from "express";

const router = express.Router();

const ARCHIVE_ORIGIN = "https://archive.org";
const USER_AGENT = "AJN-Media-Console/ArchiveProxy";

function isSafeArchivePath(raw: string): boolean {
  if (!raw || !raw.startsWith("/")) return false;
  if (raw.includes("\0")) return false;
  if (/^\/\//.test(raw)) return false;
  return raw.startsWith("/download/") || /^\/\d+\/items\//.test(raw);
}

function normalizeArchivePath(raw: string): string {
  const q = raw.indexOf("?");
  const pathname = q >= 0 ? raw.slice(0, q) : raw;
  const search = q >= 0 ? raw.slice(q) : "";

  if (pathname.startsWith("/download/")) return pathname + search;

  const match = pathname.match(/^\/\d+\/items\/([^/]+)\/(.+)$/);
  if (!match) throw new Error("Invalid Archive item path");

  const identifier = decodeURIComponent(match[1]);
  const filename = match[2]
    .split("/")
    .map((part) => encodeURIComponent(decodeURIComponent(part)))
    .join("/");

  return `/download/${encodeURIComponent(identifier)}/${filename}${search}`;
}

function isAllowedArchiveHost(hostname: string): boolean {
  return /^(?:archive\.org|ia\d+\.us\.archive\.org)$/.test(hostname);
}

/**
 * Resolve only the Archive download redirect. The browser then performs the
 * actual media GET against the Archive storage node, preserving native Range
 * handling instead of making Cloud Run proxy the media bytes.
 */
async function resolveArchiveRedirect(url: string): Promise<string | null> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "*/*",
    },
  });

  if (![301, 302, 303, 307, 308].includes(response.status)) {
    return null;
  }

  const location = response.headers.get("location");
  if (!location) return null;

  const next = new URL(location, url);

  if (next.protocol !== "https:") {
    throw new Error("Archive redirect rejected: non-HTTPS target");
  }

  if (!isAllowedArchiveHost(next.hostname)) {
    throw new Error(`Archive redirect rejected: ${next.hostname}`);
  }

  return next.toString();
}

router.get("/api/archive/proxy", async (req, res) => {
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";

  if (!isSafeArchivePath(rawPath)) {
    res.status(400).json({
      success: false,
      error:
        "Invalid Archive path. Expected /download/{identifier}/{filename} or /{node}/items/{identifier}/{filename}.",
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

  try {
    const redirectUrl = await resolveArchiveRedirect(upstreamUrl);

    if (redirectUrl) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-AJN-Archive-Proxy", "redirect-to-storage");
      res.redirect(302, redirectUrl);
      return;
    }

    // A non-redirect response from archive.org at this endpoint is not treated
    // as media because the validated storage URL is the browser transport path.
    res.status(502).json({
      success: false,
      error: "Archive did not return a validated media redirect",
    });
  } catch (error: any) {
    console.error("[ArchiveProxy] Redirect resolution failure:", error.message);

    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        error: "Archive proxy redirect failure",
        detail: error.message,
      });
    }
  }
});

export default router;
