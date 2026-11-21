import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

/** Desktop header menus that share one "which menu is open" state. */
export type NavMenuId = 'my-library' | 'vault';

/** Hover intent: wait briefly before opening so a fly-over doesn't pop a menu; wait longer before closing so a short exit doesn't snap it shut. */
const OPEN_DELAY_MS = 100;
const CLOSE_DELAY_MS = 250;

/** Hover only exists on mouse/pen devices. Touch stays tap-only. */
function canHover(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function useNavMenus() {
  const [openMenu, setOpenMenuState] = useState<NavMenuId | null>(null);
  // Mirrors of state so timers and event handlers never read a stale value.
  const openRef = useRef<NavMenuId | null>(null);
  const pinnedRef = useRef(false); // true once the user clicked or used the keyboard: hover-leave no longer closes it
  const focusFirstRef = useRef(false); // keyboard open: move focus to the first menu item after render
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null; }
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  const clearTimers = useCallback(() => { clearOpenTimer(); clearCloseTimer(); }, [clearOpenTimer, clearCloseTimer]);

  const setMenu = useCallback((id: NavMenuId | null) => {
    openRef.current = id;
    setOpenMenuState(id);
  }, []);

  const closeNow = useCallback(() => {
    clearTimers();
    pinnedRef.current = false;
    focusFirstRef.current = false;
    setMenu(null);
  }, [clearTimers, setMenu]);

  // Never leave a timer running after the header unmounts.
  useEffect(() => clearTimers, [clearTimers]);

  // Mouse enters a menu wrapper (trigger + panel + the pt-2 bridge).
  const hoverEnter = useCallback((id: NavMenuId, e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !canHover()) return;
    clearCloseTimer();
    if (openRef.current === id) return;
    clearOpenTimer();
    if (openRef.current !== null) {
      // Another menu is already open: switch instantly, no delay.
      pinnedRef.current = false;
      setMenu(id);
      return;
    }
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      pinnedRef.current = false;
      setMenu(id);
    }, OPEN_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer, setMenu]);

  // Mouse leaves a menu wrapper.
  const hoverLeave = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !canHover()) return;
    clearOpenTimer();
    if (openRef.current === null || pinnedRef.current) return;
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setMenu(null);
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer, setMenu]);

  // Trigger click. e.detail === 0 means the click came from Enter or Space (keyboard).
  const triggerClick = useCallback((id: NavMenuId, e: React.MouseEvent) => {
    clearTimers();
    const fromKeyboard = e.detail === 0;
    if (openRef.current === id) {
      if (!fromKeyboard && !pinnedRef.current) { pinnedRef.current = true; return; } // opened by hover: a click keeps it open
      closeNow();
      return;
    }
    pinnedRef.current = true;
    focusFirstRef.current = fromKeyboard;
    setMenu(id);
  }, [clearTimers, closeNow, setMenu]);

  // Trigger key: ArrowDown opens (or enters) the menu. Enter/Space arrive through triggerClick. Tab never opens anything.
  const triggerKeyDown = useCallback((id: NavMenuId, e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    clearTimers();
    pinnedRef.current = true;
    if (openRef.current === id) {
      e.currentTarget.closest('[data-nav-menu]')?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      return;
    }
    focusFirstRef.current = true;
    setMenu(id);
  }, [clearTimers, setMenu]);

  // Arrow/Home/End move between menu items (only while focus is on an item).
  const menuKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next].focus();
  }, []);

  // Keyboard focus leaves the open menu (e.g. Tab away): close it. Ignores window blur and clicks on non-focusable areas.
  const wrapperBlur = useCallback((id: NavMenuId, e: React.FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null;
    if (!next || e.currentTarget.contains(next)) return;
    if (openRef.current === id) closeNow();
  }, [closeNow]);

  // After a keyboard open, put focus on the first menu item.
  useEffect(() => {
    if (openMenu === null || !focusFirstRef.current) return;
    focusFirstRef.current = false;
    document.querySelector<HTMLElement>(`[data-nav-menu="${openMenu}"] [role="menuitem"]`)?.focus();
  }, [openMenu]);

  // Outside mousedown closes; Escape closes and returns focus to that menu's trigger.
  useEffect(() => {
    if (openMenu === null) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.closest('[data-nav-menu]')) closeNow();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement as HTMLElement | null;
      const wrap = active?.closest<HTMLElement>('[data-nav-menu]') ?? null;
      closeNow();
      wrap?.querySelector<HTMLElement>('[data-nav-trigger]')?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [openMenu, closeNow]);

  return { openMenu, closeNow, hoverEnter, hoverLeave, triggerClick, triggerKeyDown, menuKeyDown, wrapperBlur };
}
