/* What plays after a Rush hour. One function feeds both the auto-advance and the
 * "Up Next" line, so they cannot disagree. Network work is done once per play
 * (the episode's hours; and, at a day's last hour with continuation on, the next
 * available date) and the result is reused. */
export const RUSH_PROGRAM = /^rush-vod-(\d{4}-\d{2}-\d{2})-h(\d+)$/;

export interface RushNextItem { archivePath: string; title: string; subtitle: string; programId: string; date: string; hour: number }
export type RushNext =
  | { kind: 'next'; item: RushNextItem }
  | { kind: 'end_of_day' }       // continuation off
  | { kind: 'end_of_archive' }   // continuation on, no later date
  | { kind: 'failed'; failureReason: 'timeout' | 'offline' | 'http' | 'empty'; httpStatus?: number; lookupDurationMs: number };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export const rushTitle = (date: string, hour: number) => `Rush Limbaugh — ${date} (Hour ${hour})`;
const item = (date: string, hour: number, track: any): RushNextItem => ({
  archivePath: track.archivePath, title: rushTitle(date, hour), subtitle: 'The Rush Limbaugh Show', programId: `rush-vod-${date}-h${hour}`, date, hour,
});

/** GET json with one retry on network/5xx/429 (2 s apart); 4xx is final. */
async function getJson(url: string, f: Fetch, stale: () => boolean): Promise<{ ok: true; data: any } | { ok: false; failureReason: 'timeout' | 'offline' | 'http'; httpStatus?: number }> {
  let last: { ok: false; failureReason: 'timeout' | 'offline' | 'http'; httpStatus?: number } = { ok: false, failureReason: 'offline' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await f(url, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return { ok: true, data: await r.json() };
      last = { ok: false, failureReason: 'http', httpStatus: r.status };
      if (r.status < 500 && r.status !== 429) return last;
    } catch (e: any) {
      last = { ok: false, failureReason: e?.name === 'TimeoutError' ? 'timeout' : 'offline' };
    }
    if (attempt === 1) { await new Promise((ok) => setTimeout(ok, 2000)); if (stale()) return last; }
  }
  return last;
}

export async function resolveRushNext(programId: string, continueAcrossDates: boolean, f: Fetch = fetch, stale: () => boolean = () => false): Promise<RushNext> {
  const t0 = performance.now();
  const m = RUSH_PROGRAM.exec(programId);
  const fail = (failureReason: 'timeout' | 'offline' | 'http' | 'empty', httpStatus?: number): RushNext => ({ kind: 'failed', failureReason, httpStatus, lookupDurationMs: Math.round(performance.now() - t0) });
  if (!m) return fail('empty');
  const [, date, hStr] = m;
  const hour = Number(hStr);
  const day = await getJson(`/api/rush/episode/${date}`, f, stale);
  if (day.ok === false) { const d = day as any; return fail(d.failureReason, d.httpStatus); }
  const tracks: any[] = day.data?.episodes?.[0]?.tracks ?? [];
  if (!tracks.length) return fail('empty');
  if (tracks[hour]) return { kind: 'next', item: item(date, hour + 1, tracks[hour]) }; // tracks are 0-based
  if (!continueAcrossDates) return { kind: 'end_of_day' };
  const nx = await getJson(`/api/rush/next/${date}`, f, stale);
  if (nx.ok === false) { const d = nx as any; return fail(d.failureReason, d.httpStatus); }
  if (!nx.data?.nextDate) return { kind: 'end_of_archive' };
  const first = nx.data.episodes?.[0]?.tracks?.[0];
  return first ? { kind: 'next', item: item(nx.data.nextDate, 1, first) } : fail('empty');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const prettyDate = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${dd}, ${y}`; };

export function upNextLabel(n: RushNext | null, currentDate?: string): string | null {
  if (!n) return null;
  if (n.kind === 'next') return n.item.date === currentDate ? `Up next: Hour ${n.item.hour}` : `Up next: ${prettyDate(n.item.date)} — Hour ${n.item.hour}`;
  if (n.kind === 'end_of_day') return 'Up next: end of this day (continue to next date is off)';
  if (n.kind === 'end_of_archive') return 'Up next: end of the Rush archive';
  return null;
}
