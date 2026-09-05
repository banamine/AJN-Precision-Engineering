const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

server = server.replace(
  'if (req.headers[h]) headers[h] = req.headers[h];',
  'if (req.headers[h]) headers[h] = String(req.headers[h]);'
);

fs.writeFileSync('server.ts', server);
