/**
 * Tiny shared store so #dev can read the Rumble wall's REAL state. The wall is unmounted when another
 * route is showing, so a DOM query would always read 0; the wall reports itself here instead.
 * No timers, no estimates: counts change only when a panel actually mounts or unmounts an iframe.
 */
export interface WallState {
  /** True while RumbleNewsWall is mounted. */
  open: boolean;
  /** Rumble iframes currently mounted by the wall (0 whenever the wall is not open). */
  iframes: number;
}

let state: WallState = { open: false, iframes: 0 };

export function getWallState(): WallState {
  return state;
}

/** Call when the wall mounts; call the returned function when it unmounts. */
export function wallOpened(): () => void {
  state = { open: true, iframes: state.iframes };
  return () => {
    state = { open: false, iframes: 0 };
  };
}

/** Call when a panel mounts an iframe; call the returned function when it removes it. Idempotent. */
export function iframeMounted(): () => void {
  let released = false;
  state = { ...state, iframes: state.iframes + 1 };
  return () => {
    if (released) return;
    released = true;
    state = { ...state, iframes: Math.max(0, state.iframes - 1) };
  };
}

/** Test helper. */
export function resetWallStateForTests(): void {
  state = { open: false, iframes: 0 };
}
