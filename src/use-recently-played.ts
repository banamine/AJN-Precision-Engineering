import { MediaType, RecentlyPlayedItem } from './types';

const RECENTLY_PLAYED_KEY = 'ajn-recently-played';
const RECENTLY_PLAYED_EVENT = 'ajn-recently-played-changed';
const MAX_ITEMS = 5;

function emitChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RECENTLY_PLAYED_EVENT));
  }
}

export function getRecentlyPlayed(): RecentlyPlayedItem[] {
  try {
    const stored = localStorage.getItem(RECENTLY_PLAYED_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecentlyPlayedItem => Boolean(item && typeof item.id === 'string' && typeof item.title === 'string'));
  } catch {
    return [];
  }
}

function saveRecentlyPlayed(items: RecentlyPlayedItem[]): void {
  try {
    localStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
    emitChanged();
  } catch {
    console.warn('[AJN Recently Played] Failed to save to localStorage');
  }
}

export function updateRecentlyPlayed(
  archivePath: string,
  title: string,
  subtitle: string | undefined,
  mediaType: MediaType,
  src: string,
): RecentlyPlayedItem[] {
  const items = getRecentlyPlayed();
  const id = archivePath || src;
  const existingIndex = items.findIndex((item) => item.id === id);
  const now = Date.now();

  if (existingIndex >= 0) {
    const existing = items[existingIndex];
    const updated: RecentlyPlayedItem = {
      ...existing,
      title,
      subtitle: subtitle ?? existing.subtitle,
      mediaType,
      src,
      archivePath: archivePath || existing.archivePath,
      lastPlayedAt: now,
    };
    items.splice(existingIndex, 1);
    items.unshift(updated);
  } else {
    items.unshift({
      id,
      title,
      subtitle,
      mediaType,
      src,
      archivePath,
      lastPlayedAt: now,
      completed: false,
    });
  }

  saveRecentlyPlayed(items);
  return items.slice(0, MAX_ITEMS);
}

export function markCompleted(id: string): RecentlyPlayedItem[] {
  const items = getRecentlyPlayed();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return items;

  items[index] = {
    ...items[index],
    completed: true,
    resumePosition: undefined,
  };
  saveRecentlyPlayed(items);
  return items;
}

export function clearCompletedState(id: string): RecentlyPlayedItem[] {
  const items = getRecentlyPlayed();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return items;

  if (!items[index].completed && items[index].resumePosition === undefined) return items;

  items[index] = {
    ...items[index],
    completed: false,
    resumePosition: undefined,
  };
  saveRecentlyPlayed(items);
  return items;
}

export function subscribeRecentlyPlayed(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(RECENTLY_PLAYED_EVENT, listener);
  return () => window.removeEventListener(RECENTLY_PLAYED_EVENT, listener);
}
