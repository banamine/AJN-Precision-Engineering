const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

server = server.replace(
  'if (req.headers.range) headers.Range = req.headers.range;',
  'if (req.headers.range) headers.Range = req.headers.range;\n  for (const h of ["if-range", "if-match", "if-none-match", "if-modified-since", "if-unmodified-since"]) {\n    if (req.headers[h]) headers[h] = req.headers[h];\n  }'
);

fs.writeFileSync('server.ts', server);
