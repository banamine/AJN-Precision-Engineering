/* M3U + XMLTV for external players (VLC, TiviMate, Perfect Player…), both
 * serialized from ONE cached schedule snapshot per guide, so the two always
 * describe the same lineup (same generatedAt). These are readers: they never
 * search Archive or rebuild a guide beyond the normal cached guide read.
 *
 * Note for users: an archive channel in an external player is a playlist of
 * files played from the start (VOD order), not a clock-synchronized live feed.
 * Live TV channels are real live streams. */
import type { Program, ScheduleChannel } from '../src/types';

export interface ExportSnapshot { guideId: string; generatedAt: string; channels: ScheduleChannel[] }

/** XMLTV time: "YYYYMMDDhhmmss +0000". */
export function xmltvTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`;
}
const xml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const m3uAttr = (s: unknown) => String(s ?? '').replace(/["\r\n]/g, ' ').trim();
const m3uTitle = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/,/g, ' ').trim();

/** A URL an outside player can open: Archive files as canonical archive.org links
 *  (never an ia8xxxx server), other absolute URLs as-is, our relative proxy URLs
 *  made absolute against this server. */
export function externalUrl(p: Program, origin: string): string | null {
  const raw = String(p.archivePath || p.mediaUrl || '');
  if (!raw) return null;
  if (raw.startsWith('/download/')) return `https://archive.org${raw}`;
  const proxied = /^\/api\/archive\/proxy\?path=([^&]+)/.exec(raw);
  if (proxied) { const path = decodeURIComponent(proxied[1]); if (path.startsWith('/download/')) return `https://archive.org${path}`; }
  if (/^https:\/\/ia\d+\.[a-z0-9.]*archive\.org\//i.test(raw)) return null; // edge server links expire: never publish them
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return origin + raw;
  return null;
}

function times(p: Program): { start: string; stop: string } | null {
  if (p.startTimeUtc && p.endTimeUtc && Date.parse(p.endTimeUtc) > Date.parse(p.startTimeUtc)) return { start: p.startTimeUtc, stop: p.endTimeUtc };
  return null;
}
const unique = (ps: Program[]) => { const seen = new Set<string>(); return ps.filter((p) => { const k = String(p.archivePath || p.mediaUrl); if (seen.has(k)) return false; seen.add(k); return true; }); };

/** Length of an Archive clip link (…?start=0&end=282), else 0. */
function clipSeconds(u: unknown): number {
  const m = /[?&]start=(\d+(?:\.\d+)?)&end=(\d+(?:\.\d+)?)/.exec(String(u ?? ''));
  return m ? Math.max(0, Number(m[2]) - Number(m[1])) : 0;
}

export function toM3u(snap: ExportSnapshot, channelIds: string[] | null, origin: string): string {
  const lines = ['#EXTM3U', `# AJN guide ${snap.guideId} · generatedAt ${snap.generatedAt}`];
  for (const ch of snap.channels) {
    if (channelIds && !channelIds.includes(ch.id)) continue;
    const live = ch.programs.some((p) => (p.metadata as any)?.live);
    // A grouped news show is several clips: list each clip with its own length,
    // so the file and its #EXTINF duration always match.
    const expanded = ch.programs.flatMap((p) => {
      const segs: any[] = Array.isArray((p.metadata as any)?.segments) ? (p.metadata as any).segments : [];
      return segs.length > 1 ? segs.map((sg, i) => ({ ...p, archivePath: sg.archivePath, mediaUrl: sg.mediaUrl ?? sg.archivePath,
        title: `${p.title} (part ${i + 1} of ${segs.length})`, metadata: { durationSeconds: sg.durationSeconds ?? clipSeconds(sg.archivePath ?? sg.mediaUrl) } } as Program)) : [p];
    });
    const items = live ? ch.programs.slice(0, 1) : unique(expanded);
    for (const p of items) {
      const url = externalUrl(p, origin);
      if (!url) continue;
      const secs = Math.round(Number((p.metadata as any)?.durationSeconds) || 0);
      const dur = live || !(secs > 0) ? -1 : secs; // integer seconds; -1 = live/unknown
      const title = live ? ch.name : `${ch.name} - ${p.title}`;
      lines.push(`#EXTINF:${dur} tvg-id="${m3uAttr(ch.id)}" tvg-name="${m3uAttr(ch.name)}"${ch.logo ? ` tvg-logo="${m3uAttr(ch.logo)}"` : ''} group-title="${m3uAttr(ch.group || snap.guideId)}",${m3uTitle(title)}`, url);
    }
  }
  return lines.join('\n') + '\n';
}

export function toXmltv(snap: ExportSnapshot, channelIds: string[] | null): string {
  const chans = snap.channels.filter((c) => !channelIds || channelIds.includes(c.id));
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', `<tv generator-info-name="AJN Precision Engineering" date="${xmltvTime(snap.generatedAt)}">`];
  for (const c of chans) out.push(`  <channel id="${xml(c.id)}"><display-name>${xml(c.name)}</display-name>${c.logo ? `<icon src="${xml(c.logo)}"/>` : ''}</channel>`);
  for (const c of chans) for (const p of c.programs) {
    const t = times(p);
    if (!t) continue;
    out.push(`  <programme start="${xmltvTime(t.start)}" stop="${xmltvTime(t.stop)}" channel="${xml(c.id)}"><title>${xml(p.title)}</title>${p.description ? `<desc>${xml(p.description)}</desc>` : ''}${c.group ? `<category>${xml(c.group)}</category>` : ''}</programme>`);
  }
  out.push('</tv>');
  return out.join('\n') + '\n';
}
