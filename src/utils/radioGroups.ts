/* Radio station groups: a small, fixed set of live-radio stations kept together behind one control
 * (dropdown + Back/Forward). Pure functions + injectable storage so they can be tested without a browser. */

export interface RadioGroupMember { id: string; label: string }
export interface RadioGroupDef { id: string; title: string; members: RadioGroupMember[] }

/** Classic Hits 109 family. Order = dropdown order. Ids are the directory ids (server/data/liveRadio*.json). */
export const RADIO_GROUPS: RadioGroupDef[] = [
  {
    id: 'ch109',
    title: 'Classic Hits 109',
    members: [
      { id: 'radio:rb-34135e58-c4b4-4aaa-89b3-c42254ba7307', label: 'Classic Hits 109 (70s–90s main channel)' },
      { id: 'radio:rb-c1cf4123-bf67-4058-a89a-70008a531976', label: 'Country Hits' },
      { id: 'radio:rb-c4481bd4-0a22-44f5-bec0-1b2556ddbe89', label: 'Yacht Rock / Mellow Gold' },
      { id: 'radio:ch109-original', label: 'The Original (60s 70s 80s)' },
      { id: 'radio:ch109-classic-rock-109', label: 'Classic Rock 109' },
      { id: 'radio:ch109-warm-109', label: 'Warm 109' },
      { id: 'radio:ch109-summertime-hits', label: 'Summertime Hits' },
      { id: 'radio:ch109-one-hit-wonders', label: 'One Hit Wonders' },
      { id: 'radio:ch109-christmas', label: 'Christmas' },
    ],
  },
];

export const RADIO_GROUP_KEY = 'ajn.radio.group.v1';
export interface GroupStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface GroupSelection { groupId: string; stationId: string | null }

function store(s?: GroupStorage): GroupStorage | null {
  try { return s ?? (typeof window === 'undefined' ? null : window.localStorage); } catch { return null; }
}

/** Last chosen group and station. Anything unknown (old id, edited storage) falls back to the first group, no station. */
export function loadGroupSelection(groups: RadioGroupDef[] = RADIO_GROUPS, storage?: GroupStorage): GroupSelection {
  const first: GroupSelection = { groupId: groups[0]?.id ?? '', stationId: null };
  const s = store(storage);
  if (!s) return first;
  try {
    const o = JSON.parse(s.getItem(RADIO_GROUP_KEY) ?? 'null') as Partial<GroupSelection> | null;
    const g = groups.find((x) => x.id === o?.groupId);
    if (!g) return first;
    const ok = typeof o?.stationId === 'string' && g.members.some((m) => m.id === o.stationId);
    return { groupId: g.id, stationId: ok ? (o!.stationId as string) : null };
  } catch { return first; }
}

export function saveGroupSelection(sel: GroupSelection, storage?: GroupStorage): void {
  const s = store(storage);
  if (!s) return;
  try { s.setItem(RADIO_GROUP_KEY, JSON.stringify(sel)); } catch { /* private mode / quota: selection just isn't remembered */ }
}

/** Next/previous index in a list of `length` items, wrapping around. From "nothing selected": Forward = first, Back = last. */
export function stepIndex(current: number, length: number, dir: 1 | -1): number {
  if (length <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : length - 1;
  return (current + dir + length) % length;
}
