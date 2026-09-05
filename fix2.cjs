const fs = require('fs');
let text = fs.readFileSync('src/components/PlayerView.tsx', 'utf8');

const funcDef = `const handleProgramEnded = async () => {
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
  };`;

text = text.replace("import { useStat" + funcDef, "import { useState, useEffect } from 'react';");
text = text.replace("    }  };\n\n\n\n\n\n\n\n", "");

let compStart = text.indexOf("export function PlayerView(");
let stateDef = text.indexOf("const [schedulePlaylist, setSchedulePlaylist] = useState<any[]>([]);", compStart);

text = text.substring(0, stateDef + 67) + "\n\n  " + funcDef + text.substring(stateDef + 67);
fs.writeFileSync('src/components/PlayerView.tsx', text);
