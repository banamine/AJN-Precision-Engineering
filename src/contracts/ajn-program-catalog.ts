import type { AjnCategoryDestination, AjnMediaRecord } from "./ajn-media";
import { AJN_VISUAL_ASSET_MAP } from "./ajn-visual-assets";
import { defaultAjnPresentationAdapter } from "./ajn-media-adapter";
import type { Program } from "../types";

export const AJN_CATEGORY_DESTINATIONS: readonly AjnCategoryDestination[] = [
  { key: "alex-jones-show", title: "Alex Jones Show", visualAssetKey: "alex-jones-show", category: "AJN", destination: "browse" },
  { key: "war-room", title: "War Room", visualAssetKey: "war-room", category: "AJN", destination: "browse" },
  { key: "special-coverage", title: "Special Coverage", visualAssetKey: "special-coverage", category: "Special Coverage", destination: "browse" },
  { key: "special-report", title: "Special Report", visualAssetKey: "special-report", category: "Special Coverage", destination: "browse" },
  { key: "emergency-broadcast", title: "Emergency Broadcast", visualAssetKey: "emergency-broadcast", category: "Special Coverage", destination: "browse" },
  { key: "classic-archive", title: "Classic Episodes", visualAssetKey: "classic-archive", category: "Classic TV", destination: "browse" },
] as const;

export function toAjnMediaRecords(programs: readonly Program[]): AjnMediaRecord[] {
  return programs.map((program) => {
    const record = defaultAjnPresentationAdapter.fromProgram(program);
    const asset = findVisualAsset(program.title, program.metadata?.category as string | undefined);
    return asset ? { ...record, visualAssetKey: asset.key } : record;
  });
}

function findVisualAsset(title: string, category?: string) {
  const haystack = `${title} ${category ?? ""}`.toLowerCase();
  if (haystack.includes("war room")) return AJN_VISUAL_ASSET_MAP["war-room"];
  if (haystack.includes("alex jones")) return AJN_VISUAL_ASSET_MAP["alex-jones-show"];
  if (haystack.includes("special report")) return AJN_VISUAL_ASSET_MAP["special-report"];
  if (haystack.includes("emergency")) return AJN_VISUAL_ASSET_MAP["emergency-broadcast"];
  if (haystack.includes("special coverage")) return AJN_VISUAL_ASSET_MAP["special-coverage"];
  if (haystack.includes("classic")) return AJN_VISUAL_ASSET_MAP["classic-archive"];
  return undefined;
}
