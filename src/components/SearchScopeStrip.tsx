/* Scope switcher under a search bar (Entry 042): one tap moves between the Media Archive Library and the TV News
 * archive; the typed text travels with you through useSharedSearch. Cockpit keys, active scope latched. */
export type SearchScope = 'library' | 'tvnews';
const SCOPES: Array<{ id: SearchScope; label: string; hash: string }> = [
  { id: 'library', label: 'Media Archive Library', hash: '#library' },
  { id: 'tvnews', label: 'TV News Archive', hash: '#search' },
];

export function SearchScopeStrip({ active, go = (hash: string) => { window.location.hash = hash; } }: { active: SearchScope; go?: (hash: string) => void }) {
  return (
    <div role="group" aria-label="Search scope" data-testid="search-scope-strip" className="mt-2 flex flex-wrap items-center gap-1.5">
      {SCOPES.map((s) => (
        <button key={s.id} type="button" data-testid={`search-scope-${s.id}`} aria-pressed={active === s.id}
          onClick={() => { if (active !== s.id) go(s.hash); }}
          className={`ck-key ck-key--sm !min-h-[44px] text-[11px] font-bold uppercase tracking-wider${active === s.id ? ' is-latched' : ''}`}>
          {s.label}
        </button>
      ))}
    </div>
  );
}
