const fs = require('fs');

const file = 'server.ts';
let code = fs.readFileSync(file, 'utf8');

const oldProxy = `app.get("/api/archive/proxy", async (req: Request, res: Response) => {
  const proxyRequestId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString();
  res.setHeader("x-proxy-request-id", proxyRequestId);
  const rawPath = String(req.query.path || "");
  const validation = validateArchivePath(rawPath);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  const upstreamUrl = \`\${ARCHIVE_BASE_URL}\${validation.cleanPath}\`;
  const headers: Record<string, string> = { "User-Agent": UA };
  if (req.headers.range) headers.Range = req.headers.range;
  for (const h of ["if-range", "if-match", "if-none-match", "if-modified-since", "if-unmodified-since"]) {
    if (req.headers[h]) headers[h] = String(req.headers[h]);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const abortController = new AbortController();
      let fetchTimeout = setTimeout(() => abortController.abort(), 20000);
      const upstream = await fetch(upstreamUrl, {
        headers,
        signal: abortController.signal,
      });
      clearTimeout(fetchTimeout);
      if (upstream.ok || upstream.status === 206) {
        res.status(upstream.status);
        const contentType = upstream.headers.get("content-type");
        if (contentType) res.setHeader("Content-Type", contentType);
        res.setHeader("Accept-Ranges", "bytes");
        for (const h of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) {
          const v = upstream.headers.get(h);
          if (v) res.setHeader(h, v);
        }
        if (upstream.body) {
          const stream = Readable.fromWeb(upstream.body as any);
          stream.on('error', (err) => {
            console.error("[Proxy Stream Error]", err.message);
            if (!res.headersSent) res.status(502).end();
            else if (!res.destroyed) res.destroy();
          });
          req.on('close', () => {
            abortController.abort();
          });
          return stream.pipe(res);
        } else {
          return res.end();
        }
      }
      if (!RETRYABLE.has(upstream.status) || attempt === 3) {
        return res.status(upstream.status).json({ error: \`Archive upstream returned \${upstream.status}\` });
      }
    } catch (err: any) {
      if (attempt === 3) return res.status(502).json({ error: err?.message || "Archive upstream unavailable" });
    }
    await new Promise(r => setTimeout(r, 750 * 2 ** (attempt - 1)));
  }
});`;

const newProxy = `app.get("/api/archive/proxy", async (req: Request, res: Response) => {
  const proxyRequestId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString();
  res.setHeader("x-proxy-request-id", proxyRequestId);
  const rawPath = String(req.query.path || "");
  const validation = validateArchivePath(rawPath);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  const upstreamUrl = \`\${ARCHIVE_BASE_URL}\${validation.cleanPath}\`;
  const headers: Record<string, string> = { "User-Agent": UA };
  if (req.headers.range) headers.Range = req.headers.range;
  for (const h of ["if-range", "if-match", "if-none-match", "if-modified-since", "if-unmodified-since"]) {
    if (req.headers[h]) headers[h] = String(req.headers[h]);
  }

  let responseFinished = false;
  res.on("finish", () => {
    responseFinished = true;
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const abortController = new AbortController();
    
    req.on("close", () => {
      if (!responseFinished) {
        abortController.abort();
      }
    });

    try {
      const upstreamTimeout = setTimeout(() => {
        abortController.abort();
      }, 20000);

      let upstream: Response;
      try {
        upstream = await fetch(upstreamUrl, {
          headers,
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(upstreamTimeout);
      }

      if (!upstream.ok && upstream.status !== 206) {
        if (!RETRYABLE.has(upstream.status) || attempt === 3) {
          res.status(upstream.status >= 500 ? 503 : upstream.status).json({
            error: "Archive upstream unavailable",
            upstreamStatus: upstream.status,
          });
          return;
        }
      } else {
        res.status(upstream.status);
        const contentType = upstream.headers.get("content-type");
        if (contentType) res.setHeader("Content-Type", contentType);
        res.setHeader("Accept-Ranges", "bytes");
        for (const h of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) {
          const v = upstream.headers.get(h);
          if (v) res.setHeader(h, v);
        }

        if (!upstream.body) {
          res.status(502).json({ error: "Archive upstream returned no body" });
          return;
        }

        const nodeStream = Readable.fromWeb(upstream.body as any);

        nodeStream.on("error", (err: any) => {
          console.error("[Archive Proxy Stream Error]", err);
          if (!res.headersSent) {
            res.status(502).json({
              error: "Archive media stream failed",
              message: err?.message || "Unknown stream error",
            });
            return;
          }
          if (!res.destroyed) {
            res.destroy();
          }
        });

        res.on("error", (err: any) => {
          console.error("[Archive Proxy Response Error]", err);
        });

        nodeStream.pipe(res);
        return;
      }
    } catch (err: any) {
      if (attempt === 3) {
        res.status(503).json({ error: err?.message || "Archive upstream unavailable" });
        return;
      }
    }
    await new Promise(r => setTimeout(r, 750 * 2 ** (attempt - 1)));
  }
});`;

if (code.includes(oldProxy)) {
  code = code.replace(oldProxy, newProxy);
  fs.writeFileSync(file, code);
  console.log("Patched successfully");
} else {
  console.log("Could not find the exact old proxy block. Trying fallback replacement.");
  // fallback search
  const start = code.indexOf('app.get("/api/archive/proxy"');
  if (start !== -1) {
    const nextRoute = code.indexOf('app.get("/api/archive/metadata"', start);
    if (nextRoute !== -1) {
       code = code.substring(0, start) + newProxy + '\n' + code.substring(nextRoute);
       fs.writeFileSync(file, code);
       console.log("Patched with fallback successfully");
    } else {
       console.log("Fallback failed");
    }
  } else {
    console.log("Start block not found");
  }
}
