const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

const targetStr = `      const upstream = await fetch(upstreamUrl, {
        headers,
        signal: AbortSignal.timeout(20000),
      });`;

const replacement = `      const abortController = new AbortController();
      let fetchTimeout = setTimeout(() => abortController.abort(), 20000);
      const upstream = await fetch(upstreamUrl, {
        headers,
        signal: abortController.signal,
      });
      clearTimeout(fetchTimeout);`;

server = server.replace(targetStr, replacement);

const returnStr = `return upstream.body ? Readable.fromWeb(upstream.body as any).pipe(res) : res.end();`;
const returnReplacement = `if (upstream.body) {
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
        }`;

server = server.replace(returnStr, returnReplacement);

fs.writeFileSync('server.ts', server);
