const fs = require('fs');

let server = fs.readFileSync('server.ts', 'utf8');

server = server.replace(
  'for (const h of ["content-length", "content-range", "accept-ranges"]) {\n          const v = upstream.headers.get(h);\n          if (v) res.setHeader(h, v);\n        }',
  'res.setHeader("Accept-Ranges", "bytes");\n        for (const h of ["content-length", "content-range", "etag", "last-modified", "cache-control"]) {\n          const v = upstream.headers.get(h);\n          if (v) res.setHeader(h, v);\n        }'
);

fs.writeFileSync('server.ts', server);
