import type { ResolveFailure, ResolveResult, ResolvedMedia } from "./contract";

type FetchLike = typeof fetch;

function isMedia(value: unknown): value is ResolvedMedia {
  if (!value || typeof value !== "object") return false;
  const media = value as Record<string, unknown>;
  return (
    (media.provider === "rumble" || media.provider === "youtube") &&
    typeof media.embedId === "string" &&
    typeof media.embedSrc === "string" &&
    media.embedSrc.startsWith("https://") &&
    typeof media.title === "string"
  );
}

/** Ask the server to resolve a pasted/picked link. Never throws; failures are explicit results. */
export async function resolveNewsOnServer(
  input: string,
  timeoutMs = 8000,
  fetchImpl: FetchLike = fetch,
): Promise<ResolveResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`/api/news/resolve?url=${encodeURIComponent(input)}`, { signal: controller.signal });
    if (!response.ok) return { ok: false, reason: "upstream-error", detail: `HTTP ${response.status}` };
    const payload = (await response.json()) as { ok?: boolean; reason?: ResolveFailure; media?: unknown };
    if (payload.ok === true && isMedia(payload.media)) return { ok: true, media: payload.media };
    if (payload.ok === false && typeof payload.reason === "string") return { ok: false, reason: payload.reason };
    return { ok: false, reason: "bad-response" };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "upstream-error", detail: aborted ? undefined : "network" };
  } finally {
    clearTimeout(timer);
  }
}
