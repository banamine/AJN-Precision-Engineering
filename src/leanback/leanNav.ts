/* Pure logic for Lean-back mode (Dusk skin): spatial D-pad focus, the 16-button remote, and the Back rule.
 * No React, no DOM, no network, no random values. The component executes the plans these functions return. */
export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Box { left: number; top: number; right: number; bottom: number }
export interface Cand { id: number; box: Box }

const cx = (b: Box) => (b.left + b.right) / 2;
const cy = (b: Box) => (b.top + b.bottom) / 2;
const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.max(a0, b0) - Math.min(a1, b1)); // 0 when the intervals overlap

/** The candidate to focus when moving `dir` from `from`: nearest in that direction, strongly preferring the same row/column. null when nothing lies that way. */
export function pickNext(from: Box, cands: readonly Cand[], dir: Dir): number | null {
  let best: { id: number; score: number } | null = null;
  for (const c of cands) {
    const dx = cx(c.box) - cx(from), dy = cy(c.box) - cy(from);
    let ahead: boolean, primary: number, secondary: number, centre: number;
    if (dir === 'right' || dir === 'left') {
      ahead = dir === 'right' ? dx > 1 : dx < -1;
      primary = dir === 'right' ? Math.max(0, c.box.left - from.right) : Math.max(0, from.left - c.box.right);
      secondary = gap(from.top, from.bottom, c.box.top, c.box.bottom); centre = Math.abs(dy);
    } else {
      ahead = dir === 'down' ? dy > 1 : dy < -1;
      primary = dir === 'down' ? Math.max(0, c.box.top - from.bottom) : Math.max(0, from.top - c.box.bottom);
      secondary = gap(from.left, from.right, c.box.left, c.box.right); centre = Math.abs(dx);
    }
    if (!ahead) continue;
    const score = primary + secondary * 3 + centre * 0.25;
    if (!best || score < best.score || (score === best.score && c.id < best.id)) best = { id: c.id, score };
  }
  return best ? best.id : null;
}

export type RemoteId = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'home' | 'guide' | 'info' | 'playpause' | 'volup' | 'voldown' | 'mute' | 'chup' | 'chdown' | 'full';
export const REMOTE_BUTTONS: ReadonlyArray<{ id: RemoteId; label: string }> = [
  { id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }, { id: 'left', label: 'Left' }, { id: 'right', label: 'Right' },
  { id: 'ok', label: 'OK' }, { id: 'back', label: 'Back' }, { id: 'home', label: 'Home' }, { id: 'guide', label: 'Guide' },
  { id: 'info', label: 'Info' }, { id: 'playpause', label: 'Play/Pause' }, { id: 'volup', label: 'Vol +' }, { id: 'voldown', label: 'Vol -' },
  { id: 'mute', label: 'Mute' }, { id: 'chup', label: 'CH +' }, { id: 'chdown', label: 'CH -' }, { id: 'full', label: 'Full' },
];

export interface RemoteCtx { hash: string; hasMedia: boolean; isVideo: boolean }
export type RemoteStep =
  | { kind: 'focus'; dir: Dir } | { kind: 'key'; key: string } | { kind: 'click-focused' } | { kind: 'back' } | { kind: 'hash'; value: string }
  | { kind: 'media'; op: 'toggle' | 'vol+' | 'vol-' | 'mute' } | { kind: 'channel'; dir: 1 | -1 } | { kind: 'info' } | { kind: 'none'; reason: string };

export const onPlayerPage = (hash: string): boolean => hash === '#player';

/** What a remote button does. On the Player page the player already owns arrows, K, M and F, so those buttons send the SAME key the keyboard sends;
 *  elsewhere they act on the playing media element directly. A button that has nothing to act on says so; it never pretends. */
export function remotePlan(id: RemoteId, ctx: RemoteCtx): RemoteStep {
  const player = onPlayerPage(ctx.hash);
  const keyOr = (key: string, media: RemoteStep): RemoteStep => (player ? { kind: 'key', key } : ctx.hasMedia ? media : { kind: 'none', reason: 'Nothing is playing' });
  switch (id) {
    case 'up': return player ? { kind: 'key', key: 'ArrowUp' } : { kind: 'focus', dir: 'up' };
    case 'down': return player ? { kind: 'key', key: 'ArrowDown' } : { kind: 'focus', dir: 'down' };
    case 'left': return player ? { kind: 'key', key: 'ArrowLeft' } : { kind: 'focus', dir: 'left' };
    case 'right': return player ? { kind: 'key', key: 'ArrowRight' } : { kind: 'focus', dir: 'right' };
    case 'ok': return { kind: 'click-focused' };
    case 'back': return { kind: 'back' };
    case 'home': return { kind: 'hash', value: '' };
    case 'guide': return { kind: 'hash', value: '#tv-guide' };
    case 'info': return { kind: 'info' };
    case 'playpause': return keyOr('k', { kind: 'media', op: 'toggle' });
    case 'volup': return keyOr('ArrowUp', { kind: 'media', op: 'vol+' });
    case 'voldown': return keyOr('ArrowDown', { kind: 'media', op: 'vol-' });
    case 'mute': return keyOr('m', { kind: 'media', op: 'mute' });
    case 'chup': return ctx.hash === '#tv-guide' ? { kind: 'channel', dir: -1 } : { kind: 'none', reason: 'Channel keys work in the TV Guide' };
    case 'chdown': return ctx.hash === '#tv-guide' ? { kind: 'channel', dir: 1 } : { kind: 'none', reason: 'Channel keys work in the TV Guide' };
    case 'full':
      if (player) return ctx.isVideo ? { kind: 'key', key: 'f' } : { kind: 'none', reason: 'Full screen is for video' };
      return ctx.hasMedia && ctx.isVideo ? { kind: 'hash', value: '#player' } : { kind: 'none', reason: 'No video is playing' };
  }
}

export interface BackCtx { dialogOpen: boolean; openDrawer: boolean; hash: string }
export type BackStep = 'escape' | 'close-drawer' | 'home' | 'none';
/** Back (Backspace or the remote's Back): close a menu/dialog first, then an open drawer, then leave the page for Home. On Home it does nothing. */
export function backPlan(ctx: BackCtx): BackStep {
  if (ctx.dialogOpen) return 'escape';
  if (ctx.openDrawer) return 'close-drawer';
  return ctx.hash === '' || ctx.hash === '#' || ctx.hash === '#home' ? 'none' : 'home';
}

export const LEANBACK_SCALE = 1.35;
