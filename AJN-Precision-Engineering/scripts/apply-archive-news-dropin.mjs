import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function patchFile(file, replacements) {
  const full = path.join(root, file);
  let text = fs.readFileSync(full, "utf8");
  for (const [needle, replacement] of replacements) {
    if (!text.includes(needle)) {
      throw new Error(`${file}: required anchor not found: ${needle.slice(0, 80)}`);
    }
    text = text.replace(needle, replacement);
  }
  fs.writeFileSync(full, text, "utf8");
  console.log(`patched ${file}`);
}

// This patch only wires the new authoritative Archive routes.
// It does not replace the player, guide, scheduler, or navigation.
patchFile("server.ts", [
  [
    'import streamProxyRouter from "./server/routes/streamProxy.ts";',
    'import streamProxyRouter from "./server/routes/streamProxy.ts";\nimport archiveProxyRouter from "./server/routes/archiveProxy.ts";\nimport archiveNewsRouter from "./server/routes/archiveNews.ts";'
  ],
  [
    '  app.use(streamProxyRouter);\n  app.use(ingestionRouter);',
    '  app.use(streamProxyRouter);\n  app.use(archiveProxyRouter);\n  app.use(archiveNewsRouter);\n  app.use(ingestionRouter);'
  ]
]);

console.log("Archive playback/news drop-in applied.");
console.log("Run: npm run lint && npm run build");
