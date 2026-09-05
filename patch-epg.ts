import fs from "fs";

let content = fs.readFileSync("src/EpgGuide.tsx", "utf-8");

content = content.replace(
  "  onSelectProgram?: (archivePath: string, title: string, subtitle?: string, mediaType?: MediaType) => void;",
  "  onSelectProgram?: (archivePath: string, title: string, subtitle?: string, mediaType?: MediaType, channelId?: string, guideId?: string) => void;"
);

content = content.replace(
  "onClick={() => onSelectProgram?.(program.archivePath || program.mediaUrl, program.title, channel.name, mediaType)}",
  "onClick={() => onSelectProgram?.(program.archivePath || program.mediaUrl, program.title, channel.name, mediaType, channel.id, program.guideId)}"
);

fs.writeFileSync("src/EpgGuide.tsx", content);
