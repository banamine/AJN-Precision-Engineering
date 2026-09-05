const fs = require('fs');

let player = fs.readFileSync('src/MinimalPlayer.tsx', 'utf8');

player = player.replace(
  'import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";',
  'import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";\nimport { reportTelemetry } from "./telemetry";\nimport { NowPlayingMedia } from "./types";'
);

player = player.replace(
  'interface MinimalPlayerProps {\n  src: string;\n  title?: string;\n  onProgramEnded?: () => void;\n}',
  'interface MinimalPlayerProps {\n  src: string;\n  title?: string;\n  onProgramEnded?: () => void;\n  nowPlaying?: NowPlayingMedia;\n}'
);

player = player.replace(
  'export default function MinimalPlayer({ src, title, onProgramEnded }: MinimalPlayerProps) {',
  'export default function MinimalPlayer({ src, title, onProgramEnded, nowPlaying }: MinimalPlayerProps) {'
);

player = player.replace(
  'const onError = () => {\n      const err = vid.error;\n      setStatusText(\n        `Failed to load — ${err ? `code ${err.code}: ${err.message || "no message"}` : "upstream error"}`\n      );',
  `const onError = () => {\n      const err = vid.error;\n      setStatusText(\n        \`Failed to load — \${err ? \`code \${err.code}: \${err.message || "no message"}\` : "upstream error"}\`\n      );\n      reportTelemetry({\n        event: 'media.error',\n        guideId: nowPlaying?.guideId || null,\n        channelId: nowPlaying?.channelId || null,\n        sourceId: nowPlaying?.sourceId || null,\n        programId: nowPlaying?.programId || null,\n        assetId: nowPlaying?.assetId || null,\n        mediaPath: nowPlaying?.archivePath || null,\n        mediaErrorCode: err?.code || null,\n        mediaErrorMessage: err?.message || null,\n        readyState: vid.readyState,\n        networkState: vid.networkState\n      });`
);

fs.writeFileSync('src/MinimalPlayer.tsx', player);
