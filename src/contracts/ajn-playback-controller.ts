import type { MediaType } from "../types";
import type { AjnMediaRecord } from "./ajn-media";

export interface AjnPlaybackRequest {
  src: string;
  mediaType: MediaType;
  title: string;
  programId: string;
  archivePath?: string;
}

/**
 * Contract only for now. Existing PlayerView/MinimalPlayer remain authoritative.
 * A later integration can adapt this request into the existing play callback without
 * replacing the player implementation.
 */
export interface AjnPlaybackController {
  toPlaybackRequest(record: AjnMediaRecord): AjnPlaybackRequest | null;
}

export const defaultAjnPlaybackController: AjnPlaybackController = {
  toPlaybackRequest(record) {
    if (!record.playable || !record.playbackUrl) return null;

    return {
      src: record.playbackUrl,
      mediaType: record.mediaType,
      title: record.title,
      programId: record.programId,
      archivePath: record.archivePath,
    };
  },
};
