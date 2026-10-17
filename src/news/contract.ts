/**
 * News-wall provider contract. Provider-agnostic: Rumble implements it today;
 * a YouTube provider (later) implements the same interface and is added to
 * `src/news/registry.ts` only. Nothing else in the wall or the resolver changes.
 *
 * Pure types and helpers: shared by the browser and the server.
 */
export type NewsProviderId = "rumble" | "youtube";

/** What the user typed or what a channel pick produced. */
export type NewsInputKind = "page" | "embed" | "id";

export interface ParsedNewsInput {
  provider: NewsProviderId;
  kind: NewsInputKind;
  /** Embed id when kind is "embed" or "id"; the page's video id when kind is "page". */
  id: string;
  /** Normalised https page URL (kind "page" only). */
  pageUrl?: string;
}

export interface ResolvedMedia {
  provider: NewsProviderId;
  embedId: string;
  /** Ready-to-use iframe src (provider-specific). */
  embedSrc: string;
  title: string;
  author: string | null;
  authorUrl?: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  resolvedAt: string;
}

export type ResolveFailure =
  | "invalid-input"
  | "unsupported"
  | "not-found"
  | "upstream-error"
  | "bad-response"
  | "timeout"
  | "rate-limited"
  | "disabled";

export type ResolveResult =
  | { ok: true; media: ResolvedMedia }
  | { ok: false; reason: ResolveFailure; detail?: string };

export interface NewsProvider {
  id: NewsProviderId;
  /** Parse user input. Return null if the text is not this provider's. Must never throw. */
  parseInput(text: string): ParsedNewsInput | null;
  /** iframe src for an embed id. */
  embedSrc(embedId: string): string;
  /** A page-like URL that identifies an embed id to the provider's oEmbed (used to verify bare ids). */
  lookupUrlForEmbed(embedId: string): string;
  /** URL of the provider's oEmbed endpoint for a page URL (fixed host, query-encoded). */
  oembedUrl(pageUrl: string): string;
  /** Pull the embed id out of the oEmbed `html` field. Return null if absent. */
  extractEmbedId(html: string): string | null;
}

export const RESOLVE_FAILURE_TEXT: Record<ResolveFailure, string> = {
  "invalid-input": "That is not a video link this wall can use.",
  unsupported: "That site is not supported yet.",
  "not-found": "The provider says that video does not exist (or is private).",
  "upstream-error": "The provider did not answer correctly. Try again later.",
  "bad-response": "The provider's answer could not be read.",
  timeout: "The provider took too long to answer.",
  "rate-limited": "Too many lookups. Wait a minute and try again.",
  disabled: "Link lookup is turned off on this server.",
};
