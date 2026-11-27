/* Listen Alerts: the rules and the "seen" list live in THIS browser (localStorage). The server keeps only the transcript index and
 * never stores a rule: they travel inside one POST body and are forgotten. Pure + injectable storage, like favoritesStore. */
import { LIMITS, TERM_TYPES, sanitizeRules, type AlertRule, type AlertTerm, type TermType } from './alertMatch.ts';

export const RULES_KEY = 'ajn.listenAlerts.rules.v1';
export const SEEN_KEY = 'ajn.listenAlerts.seen.v1';
export const MAX_SEEN = 2000;

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
const defaultStorage = (): StorageLike | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function loadRules(st: StorageLike | null = defaultStorage()): AlertRule[] {
  try { const raw = st?.getItem(RULES_KEY); return raw ? sanitizeRules(JSON.parse(raw)) : []; } catch { return []; }
}
/** false = could not save (private mode / quota): the caller says so instead of pretending. */
export function saveRules(rules: readonly AlertRule[], st: StorageLike | null = defaultStorage()): boolean {
  if (!st) return false;
  try { st.setItem(RULES_KEY, JSON.stringify(sanitizeRules(rules))); return true; } catch { return false; }
}

export function loadSeen(st: StorageLike | null = defaultStorage()): Set<string> {
  try { const raw = st?.getItem(SEEN_KEY); const arr = raw ? JSON.parse(raw) : []; return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []); } catch { return new Set(); }
}
export function saveSeen(seen: Iterable<string>, st: StorageLike | null = defaultStorage()): boolean {
  if (!st) return false;
  try { st.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-MAX_SEEN))); return true; } catch { return false; }
}

export function newRuleId(now: number = Date.now(), rnd: () => number = Math.random): string { return `r${now.toString(36)}${Math.floor(rnd() * 1e6).toString(36)}`; }

export interface RuleDraft { name: string; showIds: string[] | null; terms: { type: TermType; text: string; aliases: string }[] }
/** Turns the form into a rule (aliases are comma separated). null = nothing usable yet (no name, or no term of 2+ letters). */
export function ruleFromDraft(d: RuleDraft, id: string = newRuleId()): AlertRule | null {
  const terms: AlertTerm[] = d.terms.map((t) => ({ type: TERM_TYPES.includes(t.type) ? t.type : 'keyword', text: t.text, aliases: t.aliases.split(',').map((a) => a.trim()).filter(Boolean) }));
  const [rule] = sanitizeRules([{ id, name: d.name, enabled: true, scope: d.showIds && d.showIds.length ? { kind: 'shows', showIds: d.showIds } : { kind: 'all' }, terms }]);
  return rule ?? null;
}

export function canAddRule(rules: readonly AlertRule[]): boolean { return rules.length < LIMITS.rules; }
