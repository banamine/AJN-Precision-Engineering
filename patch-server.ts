import fs from "fs";

const content = fs.readFileSync("server.ts", "utf-8");

let newContent = content;

if (!newContent.includes("patchServer(")) {
  const importStatement = `import { patchServer } from './server-patch.js';\n`;
  newContent = importStatement + newContent;
  
  const setupRoutesIndex = newContent.indexOf(`app.get('/api/search'`);
  newContent = newContent.substring(0, setupRoutesIndex) + `patchServer(app);\n\n` + newContent.substring(setupRoutesIndex);
  
  fs.writeFileSync("server.ts", newContent);
}
