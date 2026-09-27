export interface NewsChainItem {
  id: string;
  identifier: string;
  title: string;
  network: string;
  date?: string;
  description?: string;
  mediaPath: string;
  durationSeconds: number;
  sourceId: string;
  assetId: string;
}

const STORAGE_KEY = 'ajn_my_news_chain_v1';
const MAX_ITEMS = 6;

function read(): NewsChainItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function write(items: NewsChainItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  window.dispatchEvent(new CustomEvent('ajn-news-chain-changed'));
}

export function getNewsChain(): NewsChainItem[] { return read(); }

export function addToNewsChain(item: NewsChainItem): NewsChainItem[] {
  const existing = read().filter(x => x.id !== item.id && x.identifier !== item.identifier);
  write([item, ...existing]);
  return read();
}

export function removeFromNewsChain(id: string): NewsChainItem[] {
  const next = read().filter(x => x.id !== id);
  write(next);
  return next;
}

export function clearNewsChain(): void { write([]); }

export function subscribeNewsChain(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener('ajn-news-chain-changed', handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener('ajn-news-chain-changed', handler);
    window.removeEventListener('storage', handler);
  };
}

export function buildNewsChainSchedule(items: NewsChainItem[]) {
  if (!items.length) return null;
  const programs: any[] = [];
  let cursor = 0;
  let guard = 0;
  while (cursor < 24 && guard < 48) {
    const item = items[guard % items.length];
    const seconds = Math.max(60, Math.min(3600, Number(item.durationSeconds) || 300));
    const hours = Math.max(1 / 60, seconds / 3600);
    const start = cursor;
    const end = Math.min(24, cursor + hours);
    programs.push({
      id: `my-news-chain-${guard + 1}-${item.id}`,
      guideId: 'cable-tv',
      channelId: 'my-news-chain',
      title: item.title,
      description: `${item.network}${item.date ? ` • ${item.date}` : ''} • My News Chain`,
      startTime: start,
      endTime: end,
      startHour: start,
      endHour: end,
      mediaType: 'video',
      mediaUrl: item.mediaPath,
      archivePath: item.mediaPath,
      metadata: { sourceId: item.sourceId, assetId: item.assetId, chainItemId: item.id },
    });
    cursor = end;
    guard++;
    if (end >= 24) break;
  }
  return {
    id: 'my-news-chain',
    guideId: 'cable-tv',
    name: 'My News Chain',
    mediaType: 'video',
    group: 'News • Personal',
    programs,
  };
}
