/* App Health Neural Twin: readings. Every number here comes from a real source passed in through `env`
 * (media elements, the jingle store, storage, the data files, a digest check the operator ran).
 * Anything without a source is 'unwired' and says so. Nothing is random, simulated or hardcoded. */
import type { Neuron } from './topology';
import { NEURONS } from './topology';
import type { SlotStatusReport } from '../rumble/types';

export type NeuronState = 'live' | 'idle' | 'static' | 'unwired';
export interface Reading { id: string; state: NeuronState; headline: string; details: string[]; payload?: string }
export interface MediaLike { paused: boolean; currentTime: number; readyState: number; buffered: TimeRanges; dataset?: Record<string, string | undefined> }
export interface DigestProbe { ok: boolean; rttMs: number; checkedAt: number; lastUpdated?: string; stories?: number; error?: string }
export interface FrameProbe { ok: boolean; at: number; error?: string }
export interface RumbleSlotsProbe { ok: boolean; rttMs: number; checkedAt: number; report?: SlotStatusReport; error?: string }
export interface RumbleEnv { baselineGeneratedAt: string; wall: { open: boolean; iframes: number }; slots: RumbleSlotsProbe | null }
export interface TelemetryEnv {
  audio: MediaLike | null; video: MediaLike | null;
  jingle: { supported: boolean; playing: boolean; on: boolean };
  sharedQuery: string;
  counts: { concerts: number | null; fm: number | null; rssFeeds: number | null; rssCollected: number | null; podcastFeeds: number | null };
  digest: DigestProbe | null; frame: FrameProbe | null; now: number;
  /** Rumble wall readings. When absent the Rumble part says "Not wired". */
  rumble?: RumbleEnv;
}
export const DIGEST_URL = 'https://banamine.github.io/Daily-News-Digest-/data/current/data.json';

export function aheadSeconds(m: Pick<MediaLike, 'currentTime' | 'buffered'>): number {
  try {
    for (let i = 0; i < m.buffered.length; i += 1) {
      const s = m.buffered.start(i), e = m.buffered.end(i);
      if (m.currentTime >= s - 0.25 && m.currentTime <= e + 0.25) return Math.max(0, e - m.currentTime);
    }
  } catch { /* ranges cleared during a source swap */ }
  return 0;
}
const READY = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
const fmtAge = (ms: number): string => ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`;
const n = (v: number | null): string => (v === null ? 'unknown' : v.toLocaleString('en-US'));

function media(kind: 'audio' | 'video', m: MediaLike | null): Reading {
  const id = kind === 'audio' ? 'minimal-player' : 'player-view';
  if (!m) return { id, state: 'idle', headline: `No ${kind} element on the page`, details: [] };
  const retry = Number(m.dataset?.reconnect ?? 0) || 0;
  const details = [`readyState ${m.readyState} (${READY[m.readyState] ?? '?'})`, `position ${m.currentTime.toFixed(1)} s`, `buffered ahead ${aheadSeconds(m).toFixed(1)} s`];
  if (retry > 0) details.push(`reconnect attempt ${retry}`);
  return m.paused
    ? { id, state: 'idle', headline: `${kind} paused`, details }
    : { id, state: 'live', headline: `${kind} playing`, details, payload: `${kind} · ${aheadSeconds(m).toFixed(0)} s buffered${retry ? ` · retry ${retry}` : ''}` };
}

export function readNeuron(neuron: Neuron, env: TelemetryEnv): Reading {
  const id = neuron.id;
  switch (neuron.probe) {
    case 'audio-element': return { ...media('audio', env.audio), id };
    case 'video-element': return { ...media('video', env.video), id };
    case 'jingle': {
      const j = env.jingle;
      return { id, state: j.playing ? 'live' : 'idle', headline: !j.supported ? 'Waiting room not active' : j.playing ? 'Jingle playing' : 'Jingle silent', details: [`sound ${j.on ? 'on' : 'off'}`, `ajn.bufferJingle`], payload: j.playing ? 'Jingle audio · waiting room' : undefined };
    }
    case 'shared-query': return { id, state: env.sharedQuery ? 'live' : 'idle', headline: env.sharedQuery ? `Query "${env.sharedQuery}"` : 'No query typed this session', details: ['sessionStorage ajn.search.query'], payload: env.sharedQuery ? `Query · "${env.sharedQuery}"` : undefined };
    case 'count-concerts': return { id, state: env.counts.concerts === null ? 'unwired' : 'static', headline: `${n(env.counts.concerts)} concerts in the manifest`, details: ['counted from the shipped data file'] };
    case 'count-fm': return { id, state: env.counts.fm === null ? 'unwired' : 'static', headline: `${n(env.counts.fm)} FM broadcasts in the manifest`, details: ['counted from the shipped data file'] };
    case 'count-podcasts': return { id, state: env.counts.podcastFeeds === null ? 'unwired' : 'static', headline: `${n(env.counts.podcastFeeds)} podcast sources`, details: ['counted from the shipped data file'] };
    case 'count-rss': return { id, state: env.counts.rssFeeds === null ? 'unwired' : 'static', headline: `${n(env.counts.rssFeeds)} RSS feeds listed, ${n(env.counts.rssCollected)} collected by the digest`, details: ['src/data/newsRssSources.json'] };
    case 'digest': {
      const d = env.digest;
      if (!d) return { id, state: 'idle', headline: 'Not checked yet', details: ['Press "Check digest now" to run a real request.'] };
      if (!d.ok) return { id, state: 'idle', headline: 'Digest check failed', details: [d.error ?? 'unknown error', `after ${d.rttMs} ms`] };
      const age = d.lastUpdated ? env.now - Date.parse(d.lastUpdated) : NaN;
      const details = [`round trip ${d.rttMs} ms`, d.lastUpdated ? `last_updated ${d.lastUpdated}` : 'no last_updated field', `checked ${fmtAge(env.now - d.checkedAt)} ago`];
      if (d.stories !== undefined) details.push(`${d.stories} stories`);
      return { id, state: 'live', headline: Number.isFinite(age) ? `Digest updated ${fmtAge(age)} ago` : 'Digest reachable', details, payload: `Digest · ${d.stories ?? '?'} stories · ${d.rttMs} ms` };
    }
    case 'video-frame': {
      const f = env.frame;
      if (!env.video || env.video.paused) return { id, state: 'idle', headline: 'No video playing', details: ['Frames are captured only while a video plays.'] };
      if (!f) return { id, state: 'idle', headline: 'No frame captured yet', details: ['First capture happens within 30 s.'] };
      return f.ok ? { id, state: 'live', headline: `Frame captured ${fmtAge(env.now - f.at)} ago`, details: [], payload: 'Keyframe · current video' } : { id, state: 'idle', headline: 'Frame blocked', details: [f.error ?? 'the stream does not allow capture (CORS)'] };
    }
    case 'rumble-wall': {
      const r = env.rumble;
      if (!r) return { id, state: 'unwired', headline: 'Not wired', details: [neuron.emptyNote ?? 'No live signal is wired for this part yet.'] };
      const baked = env.now - Date.parse(r.baselineGeneratedAt);
      const ageText = Number.isFinite(baked) ? (baked >= 172_800_000 ? `${Math.round(baked / 86_400_000)} d` : fmtAge(baked)) : null;
      const details = [
        r.wall.open ? `${r.wall.iframes} Rumble iframe${r.wall.iframes === 1 ? '' : 's'} mounted` : '0 Rumble iframes (wall not open)',
        r.baselineGeneratedAt ? `baked baseline generatedAt ${r.baselineGeneratedAt}` : 'baked baseline has no generatedAt',
      ];
      const s = r.slots;
      if (!s) details.push('Slot check: not run. Press "Check Rumble slots now" for a real request.');
      else if (!s.ok || !s.report) details.push(`Slot check failed: ${s.error ?? 'unknown error'} (after ${s.rttMs} ms)`);
      else {
        const c = s.report.counts;
        details.push(`Slots: ${c.ok} ok, ${c.failed} failed, ${c.unchecked} unchecked, ${c.uncheckedEmbedOnly} embed-only (checked ${fmtAge(env.now - s.checkedAt)} ago, round trip ${s.rttMs} ms)`);
        if (s.report.stoppedEarly) details.push(`Pass stopped early: ${s.report.stoppedEarly}`);
        const failed = s.report.slots.filter((x) => x.status === 'failed');
        if (failed.length) details.push(`Failed: ${failed.slice(0, 5).map((x) => `${x.channelId} (${x.reason ?? 'unknown'})`).join(', ')}${failed.length > 5 ? ` +${failed.length - 5} more` : ''}`);
        const changed = s.report.slots.filter((x) => x.titleChanged === true).length;
        const mismatch = s.report.slots.filter((x) => x.embedIdMatches === false).length;
        const ended = s.report.slots.filter((x) => x.liveHint === 'ended-or-vod').length;
        if (changed) details.push(changed === 1 ? '1 title differs from the baseline' : `${changed} titles differ from the baseline`);
        if (mismatch) details.push(mismatch === 1 ? '1 embed id differs from the baseline (the wall plays the baseline id)' : `${mismatch} embed ids differ from the baseline (the wall plays the baseline id)`);
        if (ended) details.push(ended === 1 ? '1 live slot looks ended (hint only)' : `${ended} live slots look ended (hint only)`);
      }
      const headline = ageText ? `Baked baseline ${ageText} old` : 'Baked baseline date unreadable';
      return r.wall.open && r.wall.iframes > 0
        ? { id, state: 'live', headline, details, payload: `Rumble · ${r.wall.iframes} embed${r.wall.iframes === 1 ? '' : 's'} mounted` }
        : { id, state: s ? 'static' : 'idle', headline, details };
    }
    default: return { id, state: 'unwired', headline: 'Not wired', details: [neuron.emptyNote ?? 'No live signal is wired for this part yet.'] };
  }
}
export const readAll = (env: TelemetryEnv): Reading[] => NEURONS.map((x) => readNeuron(x, env));

/** One real request. Never throws; a failure is returned as ok:false with the reason. */
export async function probeDigest(fetchFn: typeof fetch, now: () => number, perf: () => number): Promise<DigestProbe> {
  const t0 = perf();
  try {
    const res = await fetchFn(DIGEST_URL, { cache: 'no-store' });
    const rtt = Math.round(perf() - t0);
    if (!res.ok) return { ok: false, rttMs: rtt, checkedAt: now(), error: `HTTP ${res.status}` };
    const j = (await res.json()) as { last_updated?: string; stories_count?: number };
    return { ok: true, rttMs: rtt, checkedAt: now(), lastUpdated: j.last_updated, stories: j.stories_count };
  } catch (e) { return { ok: false, rttMs: Math.round(perf() - t0), checkedAt: now(), error: e instanceof Error ? e.message : String(e) }; }
}

/** One real request to the slot check. Never throws; a failure is returned as ok:false with the reason. */
export async function probeRumbleSlots(fetchFn: typeof fetch, now: () => number, perf: () => number, timeoutMs = 30_000): Promise<RumbleSlotsProbe> {
  const t0 = perf();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn('/api/rumble/slots/status', { cache: 'no-store', signal: controller.signal });
    const rtt = Math.round(perf() - t0);
    if (!res.ok) return { ok: false, rttMs: rtt, checkedAt: now(), error: `HTTP ${res.status}` };
    const j = (await res.json()) as { ok?: boolean; reason?: string; slots?: unknown; counts?: unknown };
    if (j.ok === false) return { ok: false, rttMs: rtt, checkedAt: now(), error: j.reason ?? 'server declined' };
    if (j.ok !== true || !Array.isArray(j.slots) || !j.counts) return { ok: false, rttMs: rtt, checkedAt: now(), error: 'unexpected response' };
    return { ok: true, rttMs: rtt, checkedAt: now(), report: j as unknown as SlotStatusReport };
  } catch (e) { return { ok: false, rttMs: Math.round(perf() - t0), checkedAt: now(), error: e instanceof Error && e.name === 'AbortError' ? 'timed out' : (e instanceof Error ? e.message : String(e)) }; }
  finally { clearTimeout(timer); }
}

/** Draws the playing video onto a tiny canvas. A cross-origin stream taints the canvas: that is reported, not hidden. */
export function captureFrame(video: HTMLVideoElement, mk: () => HTMLCanvasElement, now: () => number): { probe: FrameProbe; dataUrl?: string } {
  try {
    const c = mk(); c.width = 160; c.height = 90;
    c.getContext('2d')!.drawImage(video, 0, 0, 160, 90);
    return { probe: { ok: true, at: now() }, dataUrl: c.toDataURL('image/jpeg', 0.6) };
  } catch (e) { return { probe: { ok: false, at: now(), error: e instanceof Error && e.name === 'SecurityError' ? 'blocked: the stream does not allow canvas capture (CORS)' : (e instanceof Error ? e.message : String(e)) } }; }
}
