const fs = require('fs');

let typesContent = fs.readFileSync('src/types.ts', 'utf8');

typesContent = typesContent.replace(
  'export interface NowPlayingMedia {',
  'export interface NowPlayingMedia {\n  programId?: string;\n  sourceId?: string;\n  assetId?: string;'
);

typesContent = typesContent.replace(
  'export type PlayProgramCallback = (\n  archivePath: string,\n  title: string,\n  subtitle?: string,\n  mediaType?: MediaType,\n  channelId?: string,\n  guideId?: string\n) => void;',
  'export type PlayProgramCallback = (\n  archivePath: string,\n  title: string,\n  subtitle?: string,\n  mediaType?: MediaType,\n  channelId?: string,\n  guideId?: string,\n  programId?: string,\n  sourceId?: string,\n  assetId?: string\n) => void;'
);

fs.writeFileSync('src/types.ts', typesContent);
