interface Window {
  __newsCubeHarness: {
    mount(): void;
    enqueue(payload: unknown): void;
    enqueueError(error: string): void;
    getStats(): { fetchCount: number; pauseCount: number; disposedCount: number; rendererCount: number; prepareCount: number; queued: number; lastDestination: string };
    setVisible(visible: boolean): void;
    unmount(): void;
  };
}
