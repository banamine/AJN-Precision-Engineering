import { libraryWording } from './libraryWording';

const ATTRS = ['aria-label', 'title', 'alt', 'placeholder'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'NOSCRIPT']);
const HAS = /archive/i;

function skipped(el: Element | null): boolean {
  return !!el && (SKIP.has(el.tagName) || !!el.closest('[data-keep-wording]'));
}
function fixAttrs(el: Element): void {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && HAS.test(v)) { const n = libraryWording(v); if (n !== v) el.setAttribute(a, n); }
  }
}
function fixText(n: Text): void {
  const v = n.nodeValue;
  if (v && HAS.test(v) && !skipped(n.parentElement)) { const w = libraryWording(v); if (w !== v) n.nodeValue = w; }
}
export function scrubNode(node: Node): void {
  if (node.nodeType === 3) { fixText(node as Text); return; }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  if (skipped(el)) return;
  fixAttrs(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let cur = walker.nextNode();
  while (cur) {
    if (cur.nodeType === 3) fixText(cur as Text);
    else if (!skipped(cur as Element)) fixAttrs(cur as Element);
    cur = walker.nextNode();
  }
}

/** Keeps what is on screen free of the word "archive" (rewritten to "library"). One observer; touches only text nodes and
 *  aria-label / title / alt / placeholder; never URLs, inputs or code. Opt out with data-keep-wording. Returns a disposer. */
export function installLibraryWording(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const pending = new Set<Node>();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const batch = [...pending]; pending.clear();
    for (const n of batch) if (n.isConnected) scrubNode(n);
    if (HAS.test(document.title)) document.title = libraryWording(document.title);
  };
  const schedule = () => {
    if (scheduled) return; scheduled = true;
    (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f: () => void) => setTimeout(f, 16))(flush);
  };
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach((n) => pending.add(n));
      else pending.add(r.target);
    }
    if (pending.size) schedule();
  });
  obs.observe(document.documentElement, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ATTRS });
  pending.add(document.body); schedule();
  return () => obs.disconnect();
}
