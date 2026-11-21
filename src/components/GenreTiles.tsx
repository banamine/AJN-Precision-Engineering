// Shows genre tiles (Dusk skin only): replaces the genre pill row with gradient tiles showing the real show count. Picking a tile sets the same genre filter the pills set.
import { ArrowRight } from 'lucide-react';
import type { GenreTile } from '../shows/genreTiles';

export function GenreTiles({ tiles, active, onPick }: { tiles: GenreTile[]; active: string; onPick: (pill: string) => void }) {
  return (
    <div className="ajn-tiles" role="group" aria-label="Genres" data-testid="genre-tiles">
      {tiles.map((t) => (
        <button key={t.pill} type="button" aria-pressed={t.pill === active} onClick={() => onPick(t.pill)} className="ajn-tile" style={{ backgroundImage: t.gradient }} data-genre={t.pill}>
          <span className="ajn-tile__name">{t.pill}</span>
          <span className="ajn-tile__count">{t.count} show{t.count === 1 ? '' : 's'}</span>
          <ArrowRight size={16} className="ajn-tile__arrow" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
