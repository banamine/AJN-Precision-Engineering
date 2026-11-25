/** Checks if an error stack trace originates from a browser extension (e.g. ad blockers, wallets, translators). */
export function isExtensionNoise(stack?: string | null): boolean {
  if (!stack || typeof stack !== 'string') return false;
  return /^(?:https?:\/\/[^\s]+\/)?(?:chrome-extension|moz-extension|safari-extension):\/\//im.test(stack) ||
         /(?:chrome-extension|moz-extension|safari-extension):\/\//i.test(stack);
}
