import type { Segment } from './runOfShow';
import { denverDay, denverHour } from './scheduleView';

const WD = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short' });
const T12 = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', hour12: true });

export interface WantedShow { label: string; re: RegExp }

/** Next two starts per wanted show, plain words. A show with no start in the schedule window says so; nothing is guessed. */
export function nextAirings(list: readonly Segment[], nowMs: number, wanted: readonly WantedShow[], driftMs = 0): string[] {
  const today = denverDay(nowMs);
  const tomorrow = denverDay(nowMs + 24 * 3600 * 1000);
  return wanted.map((w) => {
    const all: number[] = [];
    for (const s of list) {
      const t = s.startMs + driftMs;
      if (s.type === 'podcast' && t > nowMs && w.re.test(s.name)) all.push(t);
    }
    all.sort((a, b) => a - b);
    const starts: number[] = [];
    for (const t of all) {
      if (starts.length && t - starts[starts.length - 1] < 20 * 60 * 1000) continue;
      starts.push(t);
      if (starts.length >= 2) break;
    }
    if (!starts.length) return `${w.label}: not in the current schedule window`;
    const words = starts.map((t) => {
      const d = denverDay(t);
      const day = d === today ? (denverHour(t) >= 17 ? 'Tonight' : 'Today') : d === tomorrow ? 'Tomorrow' : WD.format(new Date(t));
      return `${day} ${T12.format(new Date(t))}`;
    });
    return `${w.label}: ${words.join(' · ')}`;
  });
}
