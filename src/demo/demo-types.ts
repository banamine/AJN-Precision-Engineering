export type DemoArchiveFixture = 'checking' | 'available' | 'slow' | 'unavailable' | 'unknown' | 'playing';
export type DemoNewsFixture = 'checking' | 'current' | 'updating' | 'delayed' | 'ready';

export interface DemoFetchFixture {
  archive: DemoArchiveFixture;
  news: DemoNewsFixture;
  offline: boolean;
  player: string;
}

export interface DemoWindow extends Window {
  __AJN_DEMO_FIXTURE__?: DemoFetchFixture;
}
