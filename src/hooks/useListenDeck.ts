import { useCallback, useMemo, useRef, useState } from 'react';
import type { PlayProgramCallback } from '../types';
import { clearShowQueue, startShowQueue } from '../utils/showQueue';
import { buildMusicItems, buildPodcastItems, orderPodcasts, loadConcertItems, loadSpokenItems, type ListenItem, type SpokenCatalog } from '../utils/listenCatalog';

/** The Listen lists (Archive Music, Live Concerts, Podcasts) and the play/preset adapters the radio deck needs.
 *  Shared by the Radio page and the RADIO drawer so both can pick from the same real lists. `enabled=false` builds nothing (the drawer has not been opened yet). */
export function useListenDeck(onPlayProgram: PlayProgramCallback, enabled = true) {
  const music = useMemo(() => (enabled ? buildMusicItems().items : []), [enabled]);
  const archivedPodcastEps = useMemo(() => (enabled ? buildPodcastItems() : []), [enabled]);
  const [spoken, setSpoken] = useState<SpokenCatalog | null>(null);
  const [spokenError, setSpokenError] = useState<string | null>(null);
  const spokenAsked = useRef(false);
  const loadSpoken = useCallback(() => {
    if (spokenAsked.current) return;
    spokenAsked.current = true;
    loadSpokenItems().then(setSpoken).catch((e: unknown) => { spokenAsked.current = false; setSpokenError(e instanceof Error ? e.message : 'could not load the podcast list'); });
  }, []);
  const podcastEps = useMemo(() => {
    // Archived episodes and server feed episodes can describe the same episode; never list one twice.
    const seen = new Set<string>();
    const merged = [...archivedPodcastEps, ...(spoken?.items ?? [])].filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });
    return orderPodcasts(merged);
  }, [archivedPodcastEps, spoken]);
  const [concerts, setConcerts] = useState<ListenItem[] | null>(null);
  const [concertsError, setConcertsError] = useState<string | null>(null);
  const concertsAsked = useRef(false);
  const loadConcerts = useCallback(() => {
    if (concertsAsked.current) return;
    concertsAsked.current = true;
    loadConcertItems().then(setConcerts).catch((e: unknown) => { concertsAsked.current = false; setConcertsError(e instanceof Error ? e.message : 'could not load the concert list'); });
  }, []);
  /** Plays every real file of an item in order (one queue); a single file plays on its own. */
  const playItem = useCallback((item: ListenItem) => {
    const files = item.tracks();
    if (files.length === 0) return;
    if (files.length === 1) {
      clearShowQueue();
      onPlayProgram(files[0].src, files[0].title, item.subtitle, 'audio', item.channelId, item.guideId, files[0].programId);
      return;
    }
    const first = startShowQueue({ mode: 'audio', items: files, missingHours: [], singleFile: false, playable: true }, item.title);
    if (first) onPlayProgram(first.src, first.title, item.title, 'audio', item.channelId, item.guideId, first.programId);
  }, [onPlayProgram]);
  const presetFor = useCallback((item: ListenItem) => {
    const first = item.tracks()[0];
    return first ? { itemId: item.id, title: item.title, subtitle: item.subtitle, src: first.src, channelId: item.channelId, guideId: item.guideId, programId: first.programId } : null;
  }, []);
  const toDeck = useCallback((list: readonly ListenItem[]) => list.map((item) => ({ id: item.id, title: item.title, subtitle: item.subtitle, publishedAt: item.publishedAt, play: () => playItem(item), preset: presetFor(item) ?? { itemId: item.id, title: item.title, src: '' } })), [playItem, presetFor]);
  const podcastsNote = spokenError ? `Podcast list unavailable: ${spokenError}` : !spoken ? (enabled ? 'Loading more podcasts…' : undefined)
    : spoken.feedsDown.length ? `${spoken.feedsDown.length} podcast feed${spoken.feedsDown.length === 1 ? '' : 's'} could not be read by the server` : undefined;
  const deckSources = useMemo(() => ({
    music: toDeck(music), podcasts: toDeck(podcastEps), concerts: concerts ? toDeck(concerts) : null, loadConcerts, concertsError, loadSpoken, podcastsNote,
  }), [music, podcastEps, concerts, concertsError, toDeck, loadConcerts, loadSpoken, podcastsNote]);
  return { music, podcastEps, spoken, spokenError, loadSpoken, concerts, concertsError, loadConcerts, playItem, presetFor, deckSources };
}
