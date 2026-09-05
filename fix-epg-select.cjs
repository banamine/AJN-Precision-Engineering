const fs = require('fs');

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

appContent = appContent.replace(
  '  const handleEpgSelect: PlayProgramCallback = useCallback((archivePath, title, subtitle, mediaType, channelId, guideId) => {\n    handlePlayProgram(archivePath, title, subtitle || \'Live EPG Schedule\', mediaType, channelId, guideId);\n  }, [handlePlayProgram]);',
  '  const handleEpgSelect: PlayProgramCallback = useCallback((archivePath, title, subtitle, mediaType, channelId, guideId, programId, sourceId, assetId) => {\n    handlePlayProgram(archivePath, title, subtitle || \'Live EPG Schedule\', mediaType, channelId, guideId, programId, sourceId, assetId);\n  }, [handlePlayProgram]);'
);

fs.writeFileSync('src/App.tsx', appContent);
