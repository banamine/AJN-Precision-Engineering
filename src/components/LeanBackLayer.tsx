// Lean-back mode (Dusk skin, user toggle in Appearance; never auto-guessed): D-pad spatial focus, Back/Home keys, and the 16-button on-screen remote (R toggles it).
// The remote sends the same actions as the keyboard: on the Player page it dispatches the same keys the player already listens for.
import { useCallback, useEffect, useRef, useState } from 'react';
import { backPlan, onPlayerPage, pickNext, remotePlan, REMOTE_BUTTONS, type Dir, type RemoteId, type RemoteStep } from '../leanback/leanNav';

const FOCUSABLE = 'button, a[href], [role="tab"], [role="button"], select, input:not([type="hidden"]), textarea, [tabindex]:not([tabindex="-1"])';
const calm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const KEY_LABEL: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backspace: 'Back', Home: 'Home' };
const DIR_OF: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function isTyping(t: HTMLElement | null): boolean {
  if (!t) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return t.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'range'].includes((t as HTMLInputElement).type);
}
function visible(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled || el.closest('[aria-hidden="true"], [inert]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}
function focusables(remote: HTMLElement | null): HTMLElement[] {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
  const scope: ParentNode = dialog ?? document.querySelector('.ajn-platform-shell') ?? document;
  const inRemote = !!remote && !!document.activeElement && remote.contains(document.activeElement);
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => visible(el) && (inRemote || !remote || !remote.contains(el)));
}
function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
}
const playingMedia = (): HTMLMediaElement | null => {
  const all = Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio'));
  return all.find((m) => !m.paused) ?? all.find((m) => !!m.currentSrc) ?? null;
};

export function LeanBackLayer() {
  const remoteRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [readout, setReadout] = useState('No remote action yet');

  const move = useCallback((dir: Dir) => {
    const list = focusables(remoteRef.current);
    if (!list.length) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body || !list.includes(active)) { focusEl(list[0]); return; }
    const box = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const id = pickNext(box(active), list.map((el, i) => ({ id: i, box: box(el) })), dir);
    if (id !== null) focusEl(list[id]);
  }, []);

  const goBack = useCallback((): string => {
    const dialogOpen = !!document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]');
    const drawer = document.querySelector<HTMLElement>('main [aria-expanded="true"][aria-controls], main li button[aria-expanded="true"]');
    const step = backPlan({ dialogOpen, openDrawer: !!drawer, hash: window.location.hash });
    if (step === 'escape') (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    else if (step === 'close-drawer') drawer?.click();
    else if (step === 'home') window.location.hash = '';
    return step === 'none' ? 'Already on Home' : 'Back';
  }, []);

  const run = useCallback((step: RemoteStep): string | null => {
    switch (step.kind) {
      case 'focus': move(step.dir); return null;
      case 'key': window.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, bubbles: true, cancelable: true })); return null;
      case 'click-focused': { const a = document.activeElement as HTMLElement | null; if (!a || a === document.body) return 'Nothing is focused'; a.click(); return null; }
      case 'back': return goBack() === 'Back' ? null : 'Already on Home';
      case 'hash': window.location.hash = step.value; return null;
      case 'channel': {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-epg-channel-row]')).filter(visible);
        if (!rows.length) return 'No channels on screen';
        const cur = rows.findIndex((r) => r.contains(document.activeElement));
        const next = rows[Math.min(rows.length - 1, Math.max(0, (cur < 0 ? (step.dir === 1 ? -1 : rows.length) : cur) + step.dir))];
        const target = next.querySelector<HTMLElement>('[data-on-air="true"]') ?? next.querySelector<HTMLElement>('[data-epg-block]') ?? next.querySelector<HTMLElement>('button');
        if (target) focusEl(target);
        return null;
      }
      case 'info': {
        const b = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label*="info" i], [data-testid*="info" i]')).find(visible);
        if (!b) return 'No info on this screen';
        b.click(); return null;
      }
      case 'media': {
        const m = playingMedia();
        if (!m) return 'Nothing is playing';
        if (step.op === 'toggle') { if (m.paused) void m.play().catch(() => setReadout('Last: Play/Pause (the browser blocked playback)')); else m.pause(); }
        else if (step.op === 'mute') m.muted = !m.muted;
        else m.volume = Math.min(1, Math.max(0, Math.round((m.volume + (step.op === 'vol+' ? 0.1 : -0.1)) * 10) / 10));
        return null;
      }
      case 'none': return step.reason;
    }
  }, [move, goBack]);

  const press = useCallback((id: RemoteId) => {
    const m = playingMedia();
    const step = remotePlan(id, { hash: window.location.hash, hasMedia: !!m, isVideo: m?.tagName === 'VIDEO' });
    const note = run(step);
    const label = REMOTE_BUTTONS.find((b) => b.id === id)?.label ?? id;
    setReadout(note ? `Last: ${label} (${note})` : `Last: ${label}`);
  }, [run]);

  useEffect(() => {
    const first = focusables(remoteRef.current)[0];
    if (first && (!document.activeElement || document.activeElement === document.body)) focusEl(first); // a focus ring is always present
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (e.key === 'r' || e.key === 'R') { if (isTyping(t)) return; e.preventDefault(); setOpen((v) => !v); return; }
      if (isTyping(t)) return;
      if (e.key === 'Home') { e.preventDefault(); window.location.hash = ''; setReadout('Last: Home'); return; }
      if (e.key === 'Backspace') { e.preventDefault(); goBack(); setReadout('Last: Back'); return; }
      const dir = DIR_OF[e.key];
      if (!dir || e.defaultPrevented || e.shiftKey) return;
      if (onPlayerPage(window.location.hash)) return; // the player owns arrows on its page
      if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range' && (dir === 'left' || dir === 'right')) return;
      e.preventDefault(); move(dir); setReadout(`Last: ${KEY_LABEL[e.key]}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, goBack]);

  return (
    <>
      <button type="button" className="ajn-remote-toggle" aria-pressed={open} onClick={() => setOpen((v) => !v)} data-testid="remote-toggle">Remote (R)</button>
      {open && (
        <div ref={remoteRef} className="ajn-remote" role="group" aria-label="Remote control" data-testid="remote">
          <div className="ajn-remote__grid">
            {REMOTE_BUTTONS.map((b) => (
              <button key={b.id} type="button" data-remote={b.id} onMouseDown={(e) => e.preventDefault()} onClick={() => press(b.id)} className="ajn-remote__btn">{b.label}</button>
            ))}
          </div>
          <p className="ajn-remote__readout" role="status" aria-live="polite" data-testid="remote-readout">{readout}</p>
        </div>
      )}
    </>
  );
}
