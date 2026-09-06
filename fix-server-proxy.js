const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

// We need to add the import and app.use
if (!code.includes('archiveProxy.js')) {
  code = code.replace(
    "import express,{Request,Response} from 'express';",
    "import express,{Request,Response} from 'express';\nimport archiveProxyRouter from './server/routes/archiveProxy.ts';"
  );
  code = code.replace(
    "const app=express(); const PORT=3000; app.use(express.json());",
    "const app=express(); const PORT=3000; app.use(express.json());\napp.use(archiveProxyRouter);"
  );
}

// Remove the old validateArchivePath and app.get('/api/archive/proxy', ...)
// Actually it's safer to just replace them.
const startIdx = code.indexOf('function validateArchivePath(raw:string){');
const endMarker = "});\n\napp.get('/api/archive/metadata',async(req,res)=>{";
const endIdx = code.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
  // We remove from startIdx up to endIdx
  code = code.slice(0, startIdx) + code.slice(endIdx + 4);
}

fs.writeFileSync('server.ts', code);
