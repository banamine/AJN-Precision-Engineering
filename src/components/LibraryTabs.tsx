import { useState } from 'react';
import type { PlayProgramCallback } from '../types';
import { LibraryView } from './LibraryView';
import { CatalogPanel } from './CatalogPanel';

/** Two tabs: the curated Library (default, unchanged) and the offline catalog of the account's own Archive favorites/uploads. */
export function LibraryTabs({ onPlayProgram }: { onPlayProgram: PlayProgramCallback }) {
  const [tab, setTab] = useState<'library' | 'catalog'>('library');
  const t = (on: boolean) => `rounded-lg px-3 py-1.5 text-xs font-medium ${on ? 'bg-neutral-100 text-neutral-950 font-semibold' : 'border border-neutral-800 text-neutral-400 hover:text-neutral-200'}`;
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Library sections" className="flex gap-2">
        <button type="button" role="tab" id="library-tab-library" aria-selected={tab === 'library'} onClick={() => setTab('library')} className={t(tab === 'library')}>Library</button>
        <button type="button" role="tab" id="library-tab-catalog" aria-selected={tab === 'catalog'} onClick={() => setTab('catalog')} className={t(tab === 'catalog')}>My Archive catalog</button>
      </div>
      {tab === 'library' ? <LibraryView onPlayProgram={onPlayProgram} /> : <CatalogPanel onPlayProgram={onPlayProgram} />}
    </div>
  );
}
