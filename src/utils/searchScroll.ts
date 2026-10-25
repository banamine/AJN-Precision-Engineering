export function shouldScrollResults(resultsTop: number, viewportHeight: number, stickyHeaderHeight: number): boolean {
  if (![resultsTop, viewportHeight, stickyHeaderHeight].every(Number.isFinite) || viewportHeight <= 0) return false;
  return resultsTop < stickyHeaderHeight || resultsTop >= viewportHeight;
}

export function searchScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? 'auto' : 'smooth';
}
