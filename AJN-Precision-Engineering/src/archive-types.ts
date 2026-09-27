export type ArchiveAssetCategory =
  | "feature" | "trailer" | "colorized" | "alternate"
  | "compilation" | "short" | "restored" | "b&w";

export interface MediaAsset {
  id: string;
  title: string;
  source: "archive.org" | "m3u" | "fixture";
  archiveIdentifier: string;
  mediaUrl: string;
  mediaType: "mp4" | "m3u8" | "mp3" | "webm";
  category: ArchiveAssetCategory;
  quality: { label: string };
  durationSeconds: number;
  playable: boolean;
}

export interface PlayoutChannel {
  id: string;
  name: string;
  playlist: MediaAsset[];
  programs?: any[];
  loop: boolean;
  shuffle: boolean;
  maxAssets: number;
}
