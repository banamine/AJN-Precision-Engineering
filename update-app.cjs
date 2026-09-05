const fs = require('fs');

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

appContent = appContent.replace(
  'const handlePlayProgram = useCallback((archivePath: string, title: string, subtitle?: string, mediaType?: MediaType, channelId?: string, guideId?: string) => {',
  'const handlePlayProgram = useCallback((archivePath: string, title: string, subtitle?: string, mediaType?: MediaType, channelId?: string, guideId?: string, programId?: string, sourceId?: string, assetId?: string) => {'
);

appContent = appContent.replace(
  'setNowPlaying({\n      src: constructedSrc,\n      title,\n      subtitle,\n      archivePath,\n      mediaType: inferredMediaType,\n      channelId,\n      guideId\n    });',
  'setNowPlaying({\n      src: constructedSrc,\n      title,\n      subtitle,\n      archivePath,\n      mediaType: inferredMediaType,\n      channelId,\n      guideId,\n      programId,\n      sourceId,\n      assetId\n    });'
);

appContent = appContent.replace(
  'const handleEpgSelect = useCallback((archivePath: string, title: string, subtitle?: string, mediaType?: MediaType, channelId?: string, guideId?: string) => {\n    handlePlayProgram(archivePath, title, subtitle || \'Live EPG Schedule\', mediaType, channelId, guideId);\n  }, [handlePlayProgram]);',
  'const handleEpgSelect = useCallback((archivePath: string, title: string, subtitle?: string, mediaType?: MediaType, channelId?: string, guideId?: string, programId?: string, sourceId?: string, assetId?: string) => {\n    handlePlayProgram(archivePath, title, subtitle || \'Live EPG Schedule\', mediaType, channelId, guideId, programId, sourceId, assetId);\n  }, [handlePlayProgram]);'
);

fs.writeFileSync('src/App.tsx', appContent);
