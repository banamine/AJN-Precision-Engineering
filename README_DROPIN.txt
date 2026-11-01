Drop-in: Radio panel keeps title bar + presets in view on a short window (PR #167).
Extract at repo root; overwrites ONE file: src/components/RadioDock.tsx (based on main 7037418).
If your AI Studio RadioDock.tsx also has the Player-page button change (PR #166), do not overwrite: apply the 3 edits by hand
 (wrap RadioPresetsBar + RadioStationGroup + directory in <div data-testid="radio-dock-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">; add shrink-0 to the title bar and radio-dock-now rows; target?.focus({ preventScroll: true })).
