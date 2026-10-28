import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';

type ThemeName = 'contrast' | 'paper' | 'white' | 'slate';
type TextChoice = 'auto' | 'white' | 'ink' | 'softblack';
type AccentChoice = 'copper' | 'blue' | 'gold' | 'green';
type FontSize = 'S' | 'M' | 'L' | 'XL';

interface AppearanceSettings {
  background: ThemeName;
  text: TextChoice;
  accent: AccentChoice;
  size: FontSize;
}

interface AppearanceContextValue extends AppearanceSettings {
  setBackground: (value: ThemeName) => void;
  setText: (value: TextChoice) => void;
  setAccent: (value: AccentChoice) => void;
  setSize: (value: FontSize) => void;
  open: () => void;
  isOpen: boolean;
  close: () => void;
}

const DEFAULTS: AppearanceSettings = { background: 'contrast', text: 'auto', accent: 'copper', size: 'M' };
const KEY = 'ajn-appearance-v1';
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

const THEMES: Record<ThemeName, { bg: string; surface: string; card: string; border: string; text: string; muted: string }> = {
  contrast: { bg: '#000000', surface: '#121212', card: '#1a1a1a', border: '#444444', text: '#ffffff', muted: '#cccccc' },
  paper: { bg: '#f2efe6', surface: '#ffffff', card: '#e8e4d9', border: '#d6d0c0', text: '#1c1c1a', muted: '#4a4a42' },
  white: { bg: '#ffffff', surface: '#ffffff', card: '#f5f5f2', border: '#e2e2dc', text: '#1c1c1a', muted: '#4a4a42' },
  slate: { bg: '#1e2528', surface: '#273035', card: '#2c373d', border: '#3c4a52', text: '#f2efe6', muted: '#a5b0b6' },
};
const ACCENTS: Record<AccentChoice, string> = { copper: '#a84e31', blue: '#315e71', gold: '#b8860b', green: '#2f6b3a' };
const SCALES: Record<FontSize, number> = { S: 0.875, M: 1, L: 1.125, XL: 1.25 };

function readSettings(): AppearanceSettings {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (!stored) return DEFAULTS;
    const value = JSON.parse(stored) as Partial<AppearanceSettings>;
    return {
      background: value.background && value.background in THEMES ? value.background : DEFAULTS.background,
      text: value.text && ['auto', 'white', 'ink', 'softblack'].includes(value.text) ? value.text : DEFAULTS.text,
      accent: value.accent && value.accent in ACCENTS ? value.accent : DEFAULTS.accent,
      size: value.size && value.size in SCALES ? value.size : DEFAULTS.size,
    };
  } catch {
    return DEFAULTS;
  }
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function setCss(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppearanceSettings>(readSettings);
  const [isOpen, setIsOpen] = useState(false);
  const colors = useMemo(() => {
    const theme = THEMES[settings.background];
    let text = theme.text;
    let muted = theme.muted;
    if (settings.text === 'white') { text = '#ffffff'; muted = '#d0d0d0'; }
    if (settings.text === 'ink') { text = '#1c1c1a'; muted = '#4a4a42'; }
    if (settings.text === 'softblack') { text = '#2b2b28'; muted = '#555550'; }
    return { ...theme, text, muted, accent: ACCENTS[settings.accent], scale: SCALES[settings.size] };
  }, [settings]);

  useEffect(() => {
    setCss('--ajn-bg', colors.bg);
    setCss('--ajn-surface', colors.surface);
    setCss('--ajn-card', colors.card);
    setCss('--ajn-border', colors.border);
    setCss('--ajn-text', colors.text);
    setCss('--ajn-muted', colors.muted);
    setCss('--ajn-accent', colors.accent);
    setCss('--ajn-accent-text', '#ffffff');
    setCss('--ajn-badge-text', settings.background === 'contrast' || settings.background === 'slate' ? '#fcd34d' : '#8a3a1f');
    setCss('--ajn-font-scale', String(colors.scale));
    document.documentElement.dataset.ajnTheme = settings.background;
    try { window.localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Settings remain active for this visit. */ }
  }, [colors, settings]);

  useEffect(() => {
    const show = () => setIsOpen(true);
    window.addEventListener('ajn:open-appearance', show);
    return () => window.removeEventListener('ajn:open-appearance', show);
  }, []);

  const value: AppearanceContextValue = {
    ...settings,
    setBackground: (background) => setSettings((current) => ({ ...current, background })),
    setText: (text) => setSettings((current) => ({ ...current, text })),
    setAccent: (accent) => setSettings((current) => ({ ...current, accent })),
    setSize: (size) => setSettings((current) => ({ ...current, size })),
    open: () => setIsOpen(true),
    isOpen,
    close: () => setIsOpen(false),
  };

  return <AppearanceContext.Provider value={value}>{children}<AppearancePanel /></AppearanceContext.Provider>;
}

function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('AppearancePanel must be used inside AppearanceProvider');
  return context;
}

function SelectField<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <label className="ajn-appearance-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function AppearancePanel() {
  const { isOpen, close, background, text, accent, size, setBackground, setText, setAccent, setSize } = useAppearance();
  if (!isOpen) return null;
  const theme = THEMES[background];
  const textColor = text === 'auto' ? theme.text : text === 'white' ? '#ffffff' : text === 'ink' ? '#1c1c1a' : '#2b2b28';
  const normalContrast = contrastRatio(textColor, theme.bg);
  const buttonContrast = contrastRatio('#ffffff', ACCENTS[accent]);
  const badgeContrast = contrastRatio(background === 'contrast' || background === 'slate' ? '#fcd34d' : '#8a3a1f', theme.card);
  const allRatiosPass = normalContrast >= 4.5 && buttonContrast >= 4.5 && badgeContrast >= 4.5;

  return (
    <div className="ajn-appearance-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="ajn-appearance-panel" role="dialog" aria-modal="true" aria-labelledby="ajn-appearance-title">
        <header className="ajn-appearance-header">
          <div>
            <p className="ajn-eyebrow">Interface settings</p>
            <h2 id="ajn-appearance-title">Appearance</h2>
          </div>
          <button type="button" className="ajn-icon-button" onClick={close} aria-label="Close appearance settings"><X size={19} /></button>
        </header>
        <p className="ajn-appearance-intro">Set the reading surface for the broadcast desk. Your choices stay on this device.</p>

        <div className="ajn-appearance-fields">
          <SelectField label="Background" value={background} onChange={setBackground} options={[
            { value: 'contrast', label: 'High Contrast' }, { value: 'paper', label: 'Paper' }, { value: 'white', label: 'White' }, { value: 'slate', label: 'Slate' },
          ]} />
          <SelectField label="Text" value={text} onChange={setText} options={[
            { value: 'auto', label: 'Theme default' }, { value: 'white', label: 'White' }, { value: 'ink', label: 'Ink' }, { value: 'softblack', label: 'Soft black' },
          ]} />
          <SelectField label="Accent" value={accent} onChange={setAccent} options={[
            { value: 'copper', label: 'Copper' }, { value: 'blue', label: 'Blue' }, { value: 'gold', label: 'Gold' }, { value: 'green', label: 'Green' },
          ]} />
          <SelectField label="Text size" value={size} onChange={setSize} options={[
            { value: 'S', label: 'Small' }, { value: 'M', label: 'Medium' }, { value: 'L', label: 'Large' }, { value: 'XL', label: 'Extra large' },
          ]} />
        </div>

        <div className="ajn-contrast-report" aria-live="polite">
          <div className="ajn-contrast-heading">
            <span>Contrast check</span>
            <span className={allRatiosPass ? 'ajn-pass' : 'ajn-warning'}>{allRatiosPass ? 'Readable' : 'Review contrast'}</span>
          </div>
          <div className="ajn-ratio-row"><span>Text on background</span><strong className={normalContrast >= 4.5 ? '' : 'ajn-warning'}>{normalContrast.toFixed(2)}:1</strong></div>
          <div className="ajn-ratio-row"><span>White on accent button</span><strong className={buttonContrast >= 4.5 ? '' : 'ajn-warning'}>{buttonContrast.toFixed(2)}:1</strong></div>
          <div className="ajn-ratio-row"><span>Badge on card</span><strong className={badgeContrast >= 4.5 ? '' : 'ajn-warning'}>{badgeContrast.toFixed(2)}:1</strong></div>
          <p>Ratios use the WCAG relative-luminance calculation. Values under 4.5:1 may be difficult to read.</p>
        </div>
        <footer className="ajn-appearance-footer">
          <button type="button" className="ajn-reset-button" onClick={() => { setBackground('contrast'); setText('auto'); setAccent('copper'); setSize('M'); }}>
            Restore defaults
          </button>
          <button type="button" className="ajn-done-button" onClick={close}><Check size={16} /> Done</button>
        </footer>
      </section>
    </div>
  );
}
