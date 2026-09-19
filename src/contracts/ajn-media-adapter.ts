import type { MediaType, Program } from "../types";
import type {
  AjnMediaRecord,
  AjnSourceAuthority,
  AjnSourceFamily,
  AjnSourceKind,
  AjnPresentationAdapter,
} from "./ajn-media";

function isKnownPlaybackSource(value: string): boolean {
  const source = value.trim();
  if (!source) return false;

  // Existing AJN playback may use absolute URLs, HLS, or Archive-style paths.
  // Do not classify arbitrary metadata as playable.
  if (/^https?:\/\//i.test(source)) return true;
  if (/^\/download\//i.test(source)) return true;
  if (/\.m3u8(?:$|[?#])/i.test(source)) return true;
  if (/\.(?:mp4|m4v|webm|mp3|aac|m4a|ogg|opus|wav)(?:$|[?#])/i.test(source)) return true;
  return false;
}

function inferSource(program: Program): {
  sourceFamily: AjnSourceFamily;
  sourceKind: AjnSourceKind;
  sourceAuthority: AjnSourceAuthority;
} {
  const source = `${program.mediaUrl} ${program.archivePath ?? ""}`.toLowerCase();
  const isArchive = source.includes("archive.org") || source.includes("/download/");
  const isAudio = program.mediaType === "audio";

  if (isArchive) {
    return {
      sourceFamily: "archive",
      sourceKind: isAudio ? "archive-audio" : "archive-video",
      sourceAuthority: "archive.org",
    };
  }

  if (isKnownPlaybackSource(program.mediaUrl)) {
    return {
      sourceFamily: "live",
      sourceKind: isAudio ? "live-audio" : "live-video",
      sourceAuthority: "external",
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
    const candidateUrl = program.mediaUrl.trim() || program.archivePath?.trim() || "";
    const playable = isKnownPlaybackSource(candidateUrl);
    const playbackUrl = playable ? candidateUrl : null;

    return {
      id: program.id,
      programId: program.id,
      title: program.title,
      mediaType: program.mediaType,
      playable,
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
