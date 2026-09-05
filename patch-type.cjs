const fs = require('fs');

const file = 'server.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace('let upstream: Response;', 'let upstream: globalThis.Response;');

fs.writeFileSync(file, code);
