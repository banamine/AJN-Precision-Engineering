import type { Program } from "../types";
import type {
  AjnMediaRecord,
  AjnSourceAuthority,
  AjnSourceFamily,
  AjnSourceKind,
  AjnPresentationAdapter,
} from "./ajn-media";

function inferSource(program: Program): {
  sourceFamily: AjnSourceFamily;
  sourceKind: AjnSourceKind;
  sourceAuthority: AjnSourceAuthority;
} {
  const source = `${program.mediaUrl} ${program.archivePath ?? ""}`.toLowerCase();
  const isArchive = source.includes("archive.org");
  const isAudio = program.mediaType === "audio";

  if (isArchive) {
    return {
      sourceFamily: "archive",
      sourceKind: isAudio ? "archive-audio" : "archive-video",
      sourceAuthority: "archive.org",
    };
  }

  return {
    sourceFamily: "unknown",
    sourceKind: "unknown",
    sourceAuthority: "unknown",
  };
}

export const defaultAjnPresentationAdapter: AjnPresentationAdapter = {
  fromProgram(program): AjnMediaRecord {
    const source = inferSource(program);
    const playbackUrl = program.mediaUrl || program.archivePath || null;

    return {
      id: program.id,
      programId: program.id,
      title: program.title,
      mediaType: program.mediaType,
      playable: Boolean(playbackUrl),
      playbackUrl,
      archivePath: program.archivePath,
      sourceFamily: source.sourceFamily,
      sourceKind: source.sourceKind,
      sourceAuthority: source.sourceAuthority,
      category: program.metadata?.category as string | undefined,
      description: program.description,
      startTime: program.startTime,
      endTime: program.endTime,
      channelId: program.channelId,
      guideId: program.guideId,
      originalProgramId: program.id,
    };
  },
};
