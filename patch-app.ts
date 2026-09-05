import fs from "fs";

let content = fs.readFileSync("src/App.tsx", "utf-8");

content = content.replace(
  "const handlePlayProgram = (src: string, title: string, subtitle?: string, mediaType: MediaType = 'video') => {",
  "const handlePlayProgram = (src: string, title: string, subtitle?: string, mediaType: MediaType = 'video', channelId?: string, guideId?: string) => {"
);

content = content.replace(
  "      subtitle,\n      mediaType,\n      isLive: true\n    });",
  "      subtitle,\n      mediaType,\n      channelId,\n      guideId,\n      isLive: true\n    });"
);

content = content.replace(
  "  const handleEpgSelect = (src: string, title: string, channelName?: string, mediaType?: MediaType) => {",
  "  const handleEpgSelect = (src: string, title: string, channelName?: string, mediaType?: MediaType, channelId?: string, guideId?: string) => {"
);

content = content.replace(
  "    handlePlayProgram(src, title, channelName, mediaType);",
  "    handlePlayProgram(src, title, channelName, mediaType, channelId, guideId);"
);

fs.writeFileSync("src/App.tsx", content);
