import fs from "fs";

let content = fs.readFileSync("src/MinimalPlayer.tsx", "utf-8");

content = content.replace(
  "interface MinimalPlayerProps {\n  src: string;\n  title?: string;\n}",
  "interface MinimalPlayerProps {\n  src: string;\n  title?: string;\n  onProgramEnded?: () => void;\n}"
);

content = content.replace(
  "export default function MinimalPlayer({ src, title }: MinimalPlayerProps) {",
  "export default function MinimalPlayer({ src, title, onProgramEnded }: MinimalPlayerProps) {"
);

content = content.replace(
  `    } else {
      setIsPlaying(false);
      setStatusText("Ended");
    }`,
  `    } else {
      setIsPlaying(false);
      setStatusText("Ended");
      if (onProgramEnded) {
        setTimeout(onProgramEnded, 1500); // 1.5s delay before next asset
      }
    }`
);

fs.writeFileSync("src/MinimalPlayer.tsx", content);
