/** Episode note for the player's "Now playing" card: the description the show's own feed gave for one podcast episode.
 *  Read from the server's in-memory podcast state; no outside request. Library back-catalog items and any text that
 *  would show the word "archive" return nothing (the app never shows that word). */
import type { Express } from 'express';
import { podcastStates, toPrograms, type PodcastState } from './podcasts';

const ID_RE = /^pod-[a-z0-9-]{1,60}-[a-z0-9]{1,16}$/i;

export function episodeNote(id: unknown, states: PodcastState[]): string | null {
  if (typeof id !== 'string' || !ID_RE.test(id) || id.includes('-ia-')) return null;
  for (const st of states) {
    if (!id.startsWith(`pod-${st.source.id}-`)) continue;
    const p = toPrograms(st, 'audio-podcasts').find((x) => x.id === id);
    const text = String(p?.description ?? '').replace(/\s+/g, ' ').trim();
    if (!text || /archive/i.test(text)) return null;
    return text.slice(0, 400);
  }
  return null;
}

export function registerEpisodeNoteRoute(app: Express): void {
  app.get('/api/podcast/episode-note', (req, res) => {
    const note = episodeNote(req.query.id, podcastStates());
    res.set('Cache-Control', 'public, max-age=300');
    if (!note) return res.status(404).json({ note: null });
    return res.json({ note });
  });
}
