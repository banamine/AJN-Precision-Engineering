const fs = require('fs');

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

appContent = appContent.replace(
  '  const handlePlayProgram = useCallback<PlayProgramCallback>((',
  '  const handlePlayProgram = useCallback<PlayProgramCallback>((\n    archivePath,\n    title,\n    subtitle,\n    mediaType,\n    channelId,\n    guideId,\n    programId,\n    sourceId,\n    assetId\n  ) => {\n'
);

appContent = appContent.replace(
  '    archivePath,\n    title,\n    subtitle,\n    mediaType,\n    channelId,\n    guideId\n  ) => {',
  '' // Already added above
);

fs.writeFileSync('src/App.tsx', appContent);
