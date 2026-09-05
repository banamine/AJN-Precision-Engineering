import fs from "fs";

let content = fs.readFileSync("src/components/PlayerView.tsx", "utf-8");

const handleEndedIndex = content.indexOf("<MinimalPlayer");

const handleEndedFunc = `
  const handleProgramEnded = async () => {
    if (!nowPlaying?.channelId) return;
    
    // Auto-advance to the next program in the channel schedule
    try {
      const res = await fetch('/api/schedule?guide=' + (nowPlaying.guideId || 'cable-tv'));
      const data = await res.json();
      const channel = (data.channels || []).find((c: any) => c.id === nowPlaying.channelId);
      if (channel && channel.programs?.length) {
        // Find current
        const currentIdx = channel.programs.findIndex((p: any) => (p.archivePath || p.mediaUrl) === nowPlaying.src);
        if (currentIdx !== -1) {
          const nextIdx = (currentIdx + 1) % channel.programs.length;
          const nextProg = channel.programs[nextIdx];
          if (nextProg) {
            onSelectProgram(
              nextProg.archivePath || nextProg.mediaUrl,
              nextProg.title,
              channel.name,
              nextProg.mediaType,
              channel.id,
              nowPlaying.guideId
            );
          }
        }
      }
    } catch (e) {
      console.error("Auto-advance failed", e);
    }
  };
`;

content = content.replace("<MinimalPlayer src={nowPlaying.src} title={nowPlaying.title} />",
  handleEndedFunc + "\n            <MinimalPlayer src={nowPlaying.src} title={nowPlaying.title} onProgramEnded={handleProgramEnded} />"
);

fs.writeFileSync("src/components/PlayerView.tsx", content);
