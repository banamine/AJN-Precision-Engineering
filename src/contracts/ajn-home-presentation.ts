import type { AjnCategoryDestination, AjnMediaRecord } from "./ajn-media";
import { defaultAjnPresentationAdapter } from "./ajn-media-adapter";
import { AJN_VISUAL_ASSETS } from "./ajn-visual-assets";
import type { Program } from "../types";

export const AJN_FEATURED_CATEGORIES: readonly AjnCategoryDestination[] = AJN_VISUAL_ASSETS.map((asset) => ({
  key: asset.key,
  title: asset.title,
  visualAssetKey: asset.key,
  category: asset.category,
  destination: asset.category === "Classic TV" ? "library" : "search",
}));

export function toAjnHomePrograms(programs: readonly Program[]): AjnMediaRecord[] {
  return programs.map((program) => defaultAjnPresentationAdapter.fromProgram(program));
}
