import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RotateCcw, X } from 'lucide-react';

type BackgroundChoice = 'contrast' | 'paper' | 'white' | 'slate';
type TextChoice = 'auto' | 'white' | 'ink' | 'softblack';
type AccentChoice = 'copper' | 'blue' | 'gold' | 'green';
type SizeChoice = 'S' | 'M' | 'L' | 'XL';

interface AppearanceSettings {
  background: BackgroundChoice;
  text: TextChoice;
  accent: AccentChoice;
  size: SizeChoice;
}

interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
}

const STORAGE_KEY = 'ajn-appearance-settings.v1';
const DEFAULTS: AppearanceSettings = { background: 'contrast', text: 'auto', accent: 'copper', size: 'M' };
const palettes: Record<BackgroundChoice, ThemeColors> = {
  contrast: { background: '#000000', surface: '#121212', card: '#1a1a1a', border: '#444444', text: '#ffffff', muted: '#cccccc', accent: '#a84e31', accentText: '#ffffff' },
  paper: { background: '#f2efe6', surface: '#ffffff', card: '#e8e4d9', border: '#d6d0c0', text: '#1c1c1a', muted: '#4a4a42', accent: '#a84e31', accentText: '#ffffff' },
  white: { background: '#ffffff', surface: '#ffffff', card: '#f5f5f2', border: '#d8d8d2', text: '#1c1c1a', muted: '#4a4a42', accent: '#a84e31', accentText: '#ffffff' },
  slate: { background: '#1e2528', surface: '#273035', card: '#2c373d', border: '#46545b', text: '#f2efe6', muted: '#c1c9cd', accent: '#a84e31', accentText: '#ffffff' },
};
const accents: Record<AccentChoice, string> = { copper: '#a84e31', blue: '#315e71', gold: '#b8860b', green: '#2f6b3a' };
const scales: Record<SizeChoice, string> = { S: '0.9375', M: '1', L: '1.125', XL: '1.25' };

function loadSettings(): AppearanceSettings {
  try {
    if (typeof window === 'undefined') return DEFAULTS;
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Partial<AppearanceSettings> | null;
    if (!value) return DEFAULTS;
    return {
      background: value.background && value.background in palettes ? value.background : DEFAULTS.background,
      text: value.text && ['auto', 'white', 'ink', 'softblack'].includes(value.text) ? value.text : DEFAULTS.text,
      accent: value.accent && value.accent in accents ? value.accent : DEFAULTS.accent,
      size: value.size && value.size in scales ? value.size : DEFAULTS.size,
    };
  } catch {
    return DEFAULTS;
  }
}

function luminance(hex: string): number {
  const rgb = hex.replace('#', '').match(/.{2}/g)?.map((part) => parseInt(part, 16) / 255) ?? [0, 0, 0];
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const colorStyle = (colors: ThemeColors, size: SizeChoice) => ({
  '--ajn-bg': colors.background,
  '--ajn-surface': colors.surface,
  '--ajn-card': colors.card,
  '--ajn-border': colors.border,
  '--ajn-text': colors.text,
  '--ajn-muted': colors.muted,
  '--ajn-accent': colors.accent,
  '--ajn-accent-text': colors.accentText,
  '--ajn-badge': colors.background === '#000000' || colors.background === '#1e2528' ? '#fcd34d' : '#8a3a1f',
  '--ajn-font-scale': scales[size],
  '--text-xs': `calc(0.75rem * ${scales[size]})`,
  '--text-sm': `calc(0.875rem * ${scales[size]})`,
  '--text-base': `calc(1rem * ${scales[size]})`,
  '--text-lg': `calc(1.125rem * ${scales[size]})`,
  '--text-xl': `calc(1.25rem * ${scales[size]})`,
  '--text-2xl': `calc(1.5rem * ${scales[size]})`,
  '--text-3xl': `calc(1.875rem * ${scales[size]})`,
} as CSSProperties);

interface AppearanceContextValue {
  openAppearance: () => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function useAjnAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAjnAppearance must be used within AjnAppearanceProvider');
  return context;
}

export function AjnAppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppearanceSettings>(loadSettings);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const base = palettes[settings.background];
  const colors = useMemo<ThemeColors>(() => {
    const text = settings.text === 'white' ? '#ffffff'
      : settings.text === 'ink' ? '#1c1c1a'
        : settings.text === 'softblack' ? '#2b2b28' : base.text;
    const lightText = text === '#ffffff' ? '#d0d0d0' : text === '#1c1c1a' ? '#4a4a42' : text === '#2b2b28' ? '#555550' : base.muted;
    return { ...base, text, muted: lightText, accent: accents[settings.accent], accentText: settings.accent === 'gold' ? '#1c1c1a' : '#ffffff' };
  }, [base, settings.accent, settings.text]);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* appearance remains usable without storage */ }
  }, [settings]);
  useEffect(() => {
    if (!open) return;
    const returnFocusTo = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('button, select')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>('button, select') ?? [])].filter((item) => !item.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      returnFocusTo?.focus();
    };
  }, [open]);

  const ratio = contrastRatio(colors.text, colors.background);
  const accentRatio = contrastRatio(colors.accentText, colors.accent);

  return (
    <AppearanceContext.Provider value={{ openAppearance: () => setOpen(true) }}>
      <div className="ajn-platform-shell" style={colorStyle(colors, settings.size)}>
        {children}
      </div>
      {open && (
        <div className="ajn-appearance-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section ref={panelRef} className="ajn-appearance-panel" role="dialog" aria-modal="true" aria-labelledby="ajn-appearance-title">
            <header className="ajn-appearance-header">
              <div>
                <p className="ajn-eyebrow">Display system</p>
                <h2 id="ajn-appearance-title">Appearance</h2>
              </div>
              <button type="button" className="ajn-icon-button" onClick={() => setOpen(false)} aria-label="Close appearance settings"><X size={20} /></button>
            </header>
            <div className="ajn-appearance-content">
              <fieldset>
                <legend>Background</legend>
                <div className="ajn-choice-grid ajn-theme-choices">
                  {([
                    ['contrast', 'High contrast', '#000000'],
                    ['paper', 'Paper', '#f2efe6'],
                    ['white', 'White', '#ffffff'],
                    ['slate', 'Slate', '#1e2528'],
                  ] as const).map(([value, label, swatch]) => (
                    <button key={value} type="button" aria-pressed={settings.background === value} onClick={() => setSettings((old) => ({ ...old, background: value }))}>
                      <span className="ajn-swatch" style={{ backgroundColor: swatch }} />{label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="ajn-field">
                <span>Text color</span>
                <select value={settings.text} onChange={(event) => setSettings((old) => ({ ...old, text: event.target.value as TextChoice }))}>
                  <option value="auto">Theme default</option><option value="white">White</option><option value="ink">Ink</option><option value="softblack">Soft black</option>
                </select>
              </label>
              <label className="ajn-field">
                <span>Accent</span>
                <select value={settings.accent} onChange={(event) => setSettings((old) => ({ ...old, accent: event.target.value as AccentChoice }))}>
                  <option value="copper">Copper</option><option value="blue">Deep blue</option><option value="gold">Ochre</option><option value="green">Pine</option>
                </select>
              </label>
              <fieldset>
                <legend>Interface size</legend>
                <div className="ajn-size-options" role="group" aria-label="Interface size">
                  {(['S', 'M', 'L', 'XL'] as const).map((size) => (
                    <button key={size} type="button" aria-pressed={settings.size === size} onClick={() => setSettings((old) => ({ ...old, size }))}>{size}</button>
                  ))}
                </div>
              </fieldset>
              <div className={`ajn-contrast-readout ${ratio >= 4.5 && accentRatio >= 4.5 ? 'is-pass' : 'is-warning'}`} role="status" aria-live="polite">
                <div><span>Text contrast</span><strong>{ratio.toFixed(2)}:1</strong></div>
                <div><span>Accent contrast</span><strong>{accentRatio.toFixed(2)}:1</strong></div>
                <p>{ratio >= 4.5 && accentRatio >= 4.5 ? 'WCAG AA contrast target met.' : 'Contrast is below the 4.5:1 AA target for normal text.'}</p>
              </div>
            </div>
            <footer className="ajn-appearance-footer">
              <button type="button" className="ajn-reset-button" onClick={() => setSettings(DEFAULTS)}><RotateCcw size={16} /> Reset to High Contrast</button>
              <button type="button" className="ajn-done-button" onClick={() => setOpen(false)}>Done</button>
            </footer>
          </section>
        </div>
      )}
    </AppearanceContext.Provider>
  );
}
