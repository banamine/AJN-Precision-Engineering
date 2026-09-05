import fs from "fs";

const content = fs.readFileSync("guideRegistry.ts", "utf-8");

const startIdx = content.indexOf("export function buildScheduleForChannel");
const endIdx = content.indexOf("export async function getScheduleForGuide");

const newFunc = `export function setChannelSources(channelId: string, sources: ChannelSource[]) {
  channelSourcesMap.set(channelId, sources);
}

export function buildScheduleForChannel(guideId: string, channel: Channel): Program[] {
  const sources = channelSourcesMap.get(channel.id) || [];
  
  if (sources.length === 0) {
    return [
      {
        id: \`prog-\${channel.id}-unavailable\`,
        guideId,
        channelId: channel.id,
        title: \`[Broadcast Unavailable — No Source Configured]\`,
        description: \`This channel currently has no active media stream source registered in the registry.\`,
        startTime: 0,
        endTime: 24,
        startHour: 0,
        endHour: 24,
        mediaType: channel.mediaType,
        mediaUrl: '',
        archivePath: '',
      },
    ];
  }

  const programs: Program[] = [];
  let currentSecond = 0;
  const secondsInDay = 24 * 3600;
  
  let sourceIndex = 0;
  let progIdx = 0;
  
  while (currentSecond < secondsInDay && sources.length > 0) {
    const activeSource = sources[sourceIndex % sources.length];
    
    // Default duration to 3600s if not specified
    const durationSec = activeSource.metadata?.durationSeconds || 3600;
    
    const startHour = currentSecond / 3600;
    const endSecond = Math.min(secondsInDay, currentSecond + durationSec);
    const endHour = endSecond / 3600;
    
    programs.push({
      id: \`prog-\${channel.id}-\${progIdx + 1}\`,
      guideId,
      channelId: channel.id,
      title: activeSource.metadata?.title || activeSource.metadata?.playlistName || \`\${channel.name} Feature\`,
      description: activeSource.metadata?.description || \`Archival broadcast media from \${activeSource.url}\`,
      startTime: startHour,
      endTime: endHour,
      startHour,
      endHour,
      mediaType: channel.mediaType,
      mediaUrl: activeSource.url,
      archivePath: activeSource.url,
    });
    
    currentSecond = endSecond;
    sourceIndex++;
    progIdx++;
    
    // Safety check to prevent infinite loops if duration is 0
    if (durationSec <= 0) break;
  }
  
  return programs;
}
`;

fs.writeFileSync("guideRegistry.ts", content.substring(0, startIdx) + newFunc + content.substring(endIdx));
