import { useEffect, useRef, useState } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'] as const;

/** true once the page has had no activity for `idleMs` (and `holdVisible` is false). Any activity shows it again at once. */
export function useIdleFade(holdVisible: boolean, idleMs = 12000): boolean {
  const [faded, setFaded] = useState(false);
  const holdRef = useRef(holdVisible);
  holdRef.current = holdVisible;
  const lastActive = useRef<number>(Date.now());

  useEffect(() => {
    const onActivity = () => {
      lastActive.current = Date.now();
      setFaded((f) => (f ? false : f));
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true });
    // One cheap check per second instead of re-arming a timer on every mouse move.
    const id = window.setInterval(() => {
      if (holdRef.current) { lastActive.current = Date.now(); return; }
      if (Date.now() - lastActive.current >= idleMs) setFaded((f) => (f ? f : true));
    }, 1000);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, { capture: true } as EventListenerOptions);
      window.clearInterval(id);
    };
  }, [idleMs]);

  return faded;
}
