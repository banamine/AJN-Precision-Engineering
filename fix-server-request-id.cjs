const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

if (!server.includes('x-proxy-request-id')) {
  server = server.replace(
    'app.get("/api/archive/proxy", async (req: Request, res: Response) => {',
    'app.get("/api/archive/proxy", async (req: Request, res: Response) => {\n  const proxyRequestId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString();\n  res.setHeader("x-proxy-request-id", proxyRequestId);'
  );
  fs.writeFileSync('server.ts', server);
}
