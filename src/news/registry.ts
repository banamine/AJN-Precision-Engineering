import type { NewsProvider, ParsedNewsInput } from "./contract";
import { rumbleProvider } from "./providers/rumble";
import { youtubeProvider } from "./providers/youtube";

/** Add a provider here (e.g. youtubeProvider) and the wall + resolver pick it up. */
// YouTube precedes Rumble because both accept 11-character bare IDs.
export const NEWS_PROVIDERS: readonly NewsProvider[] = [youtubeProvider, rumbleProvider];

export function parseNewsInput(text: string, providers: readonly NewsProvider[] = NEWS_PROVIDERS): ParsedNewsInput | null {
  for (const provider of providers) {
    const parsed = provider.parseInput(text);
    if (parsed) return parsed;
  }
  return null;
}

export function providerFor(id: string, providers: readonly NewsProvider[] = NEWS_PROVIDERS): NewsProvider | null {
  return providers.find((provider) => provider.id === id) ?? null;
}
