/**
 * BANNED VIDEO 4-panel allocator. Pure functions, no DOM, no storage: unit-tested in
 * src/bannedvideo/bannedvideo.test.ts.
 *
 * Panels:  P1 trending (rank 1→N, loops) · P2 shuffle bag (no repeats until every video was drawn)
 *          P3 vault (dated archive titles, oldest year first, shuffled within year+month)
 *          P4 rotation (fair round robin: fewest times queued first, ties by trending rank)
 * Rules:   a video is on at most ONE panel at a time. Initial claim order P1 → P3 → P2 → P4.
 *          A panel changes only when its own Next is pressed. If no unique video is left,
 *          the panel is null and the UI says so (never a duplicate, never a placeholder).
 */
import { parseAirDate } from "./airDate";
import type {
  AirDate, BannedVideoItem, BannedVideoNetwork, BannedVideoSnapshot, PanelIndex, WallFilter, WallState,
} from "./types";

export type Rng = () => number;

/** Which channel networks each view shows. RAV never appears in the AJN view and vice versa. */
export const NETWORKS_IN_VIEW: Record<WallFilter["network"], readonly BannedVideoNetwork[]> = {
  ajn: ["ajn", "other"],
  rav: ["rav"],
};

export interface VaultEntry { item: BannedVideoItem; date: AirDate }

export interface Pool {
  /** Every video in the filter, in trending-rank order. */
  items: BannedVideoItem[];
  byId: Map<string, BannedVideoItem>;
  /** Videos with a trustworthy air date (datedTitles channels only). */
  vault: VaultEntry[];
  /** Uploader channels available in the current network view, with counts (for the filter menu). */
  channelOptions: { name: string; count: number }[];
}

export function buildPool(snapshot: BannedVideoSnapshot, filter: WallFilter, now: Date = new Date()): Pool {
  const allowed = new Set(NETWORKS_IN_VIEW[filter.network]);
  const channelByName = new Map(snapshot.channels.map((c) => [c.name, c]));
  const inNetwork = snapshot.items.filter((item) => {
    const channel = channelByName.get(item.channel);
    return channel !== undefined && allowed.has(channel.network);
  });
  const counts = new Map<string, number>();
  for (const item of inNetwork) counts.set(item.channel, (counts.get(item.channel) ?? 0) + 1);
  const channelOptions = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const items = filter.channel === "all" ? inNetwork : inNetwork.filter((item) => item.channel === filter.channel);
  const vault: VaultEntry[] = [];
  for (const item of items) {
    if (!channelByName.get(item.channel)?.datedTitles) continue;
    const date = parseAirDate(item.title, now);
    if (date) vault.push({ item, date });
  }
  return { items, byId: new Map(items.map((item) => [item.id, item])), vault, channelOptions };
}

export function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Oldest year first; inside a year, unknown month first then Jan→Dec; random order inside each (year, month). */
export function buildVaultOrder(vault: readonly VaultEntry[], rng: Rng): string[] {
  const groups = new Map<string, VaultEntry[]>();
  for (const entry of vault) {
    const key = `${entry.date.year}:${entry.date.month ?? 0}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const [ay, am] = a.split(":").map(Number);
      const [by, bm] = b.split(":").map(Number);
      return ay - by || am - bm;
    })
    .flatMap(([, group]) => shuffle(group, rng).map((entry) => entry.item.id));
}

export function emptyWallState(): WallState {
  return { version: 1, panels: [null, null, null, null], trendingCursor: -1, shuffleBag: [], vaultOrder: [], vaultCursor: -1, queuedCounts: {} };
}

type Pick = { id: string; state: WallState } | null;

function pickTrending(state: WallState, pool: Pool, exclude: Set<string>): Pick {
  const n = pool.items.length;
  for (let step = 1; step <= n; step += 1) {
    const index = (((state.trendingCursor + step) % n) + n) % n;
    const id = pool.items[index].id;
    if (!exclude.has(id)) return { id, state: { ...state, trendingCursor: index } };
  }
  return null;
}

function pickShuffle(state: WallState, pool: Pool, exclude: Set<string>, rng: Rng): Pick {
  const live = state.shuffleBag.filter((id) => pool.byId.has(id));
  const fromBag = live.find((id) => !exclude.has(id));
  if (fromBag) return { id: fromBag, state: { ...state, shuffleBag: live.filter((id) => id !== fromBag) } };
  // Round finished (or every remaining id is on another panel): start a new round.
  const fresh = shuffle(pool.items.map((item) => item.id), rng);
  const fromFresh = fresh.find((id) => !exclude.has(id));
  if (!fromFresh) return null;
  return { id: fromFresh, state: { ...state, shuffleBag: fresh.filter((id) => id !== fromFresh) } };
}

function pickVault(state: WallState, pool: Pool, exclude: Set<string>, rng: Rng): Pick {
  if (pool.vault.length === 0) return null;
  const validIds = new Set(pool.vault.map((entry) => entry.item.id));
  let order = state.vaultOrder;
  let cursor = state.vaultCursor;
  if (order.length !== validIds.size || !order.every((id) => validIds.has(id))) {
    order = buildVaultOrder(pool.vault, rng);
    cursor = -1;
  }
  for (let step = 1; step <= order.length * 2; step += 1) {
    cursor += 1;
    if (cursor >= order.length) {
      // End of the vault: start again from the oldest year with a fresh in-year shuffle.
      order = buildVaultOrder(pool.vault, rng);
      cursor = 0;
    }
    const id = order[cursor];
    if (!exclude.has(id)) return { id, state: { ...state, vaultOrder: order, vaultCursor: cursor } };
  }
  return null;
}

function pickRotation(state: WallState, pool: Pool, exclude: Set<string>): Pick {
  let best: BannedVideoItem | null = null;
  for (const item of pool.items) {
    if (exclude.has(item.id)) continue;
    if (best === null || (state.queuedCounts[item.id] ?? 0) < (state.queuedCounts[best.id] ?? 0)) best = item;
  }
  return best ? { id: best.id, state } : null;
}

function pickFor(panel: PanelIndex, state: WallState, pool: Pool, exclude: Set<string>, rng: Rng): Pick {
  switch (panel) {
    case 0: return pickTrending(state, pool, exclude);
    case 1: return pickShuffle(state, pool, exclude, rng);
    case 2: return pickVault(state, pool, exclude, rng);
    case 3: return pickRotation(state, pool, exclude);
  }
}

function placed(state: WallState, panel: PanelIndex, id: string | null): WallState {
  const panels = [...state.panels] as WallState["panels"];
  panels[panel] = id;
  const queuedCounts = id === null ? state.queuedCounts : { ...state.queuedCounts, [id]: (state.queuedCounts[id] ?? 0) + 1 };
  return { ...state, panels, queuedCounts };
}

/** Claim order on a fresh wall: trending, vault, shuffle, rotation. */
export const CLAIM_ORDER: readonly PanelIndex[] = [0, 2, 1, 3];

/** Fill all four panels. Keeps queuedCounts from `previous` so fairness survives filter changes. */
export function fillWall(pool: Pool, rng: Rng, previous: WallState = emptyWallState()): WallState {
  let state: WallState = { ...emptyWallState(), queuedCounts: previous.queuedCounts };
  const taken = new Set<string>();
  for (const panel of CLAIM_ORDER) {
    const pick = pickFor(panel, state, pool, taken, rng);
    if (pick) {
      state = placed(pick.state, panel, pick.id);
      taken.add(pick.id);
    }
  }
  return state;
}

export interface NextResult { state: WallState; changed: boolean }

/**
 * Advance ONE panel. The other three never change. The panel's current video and the
 * videos on the other panels are excluded; if nothing else is left, the panel keeps its video
 * and `changed` is false (the UI reports it).
 */
export function nextInPanel(state: WallState, pool: Pool, panel: PanelIndex, rng: Rng): NextResult {
  const exclude = new Set(state.panels.filter((id): id is string => id !== null));
  const pick = pickFor(panel, state, pool, exclude, rng);
  if (!pick) return { state, changed: false };
  return { state: placed(pick.state, panel, pick.id), changed: true };
}

/** True when the saved state still fits this pool (all ids present, none duplicated). */
export function stateFitsPool(state: WallState, pool: Pool): boolean {
  const shown = state.panels.filter((id): id is string => id !== null);
  return shown.every((id) => pool.byId.has(id)) && new Set(shown).size === shown.length;
}

export function unassignedCount(state: WallState, pool: Pool): number {
  const shown = new Set(state.panels.filter((id): id is string => id !== null));
  return pool.items.filter((item) => !shown.has(item.id)).length;
}
