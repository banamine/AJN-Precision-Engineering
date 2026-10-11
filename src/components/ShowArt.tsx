import { useState } from 'react';
import { Headphones, Tv } from 'lucide-react';
import { hash32 } from '../utils/dayRotation';

const PALETTES = [
  'from-sky-700 to-indigo-900', 'from-amber-600 to-red-900', 'from-emerald-700 to-teal-900',
  'from-fuchsia-700 to-purple-900', 'from-rose-700 to-orange-900', 'from-cyan-700 to-blue-900',
];

function initials(label: string): string {
  const words = label.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || 'AJN';
}

interface Props { label: string; mediaType?: string; src?: string; load?: boolean; className?: string; iconOnly?: boolean }

/** A real image when there is one; otherwise a plain show-art tile (colour + initials). Never a fake frame. */
export function ShowArt({ label, mediaType, src, load = true, className = '', iconOnly = false }: Props) {
  const [broken, setBroken] = useState(false);
  const audio = mediaType === 'audio';
  const Icon = audio ? Headphones : Tv;
  const showImg = !!src && load && !broken;
  return (
    <div className={`relative isolate overflow-hidden bg-gradient-to-br ${PALETTES[hash32(label) % PALETTES.length]} ${className}`} data-art={showImg ? 'image' : 'placeholder'}>
      {showImg && <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setBroken(true)} className="absolute inset-0 z-[1] h-full w-full object-cover" />}
      {!showImg && (
        <div className="absolute inset-0 flex items-center justify-center">
          {iconOnly ? <Icon className="h-5 w-5 text-white/70" aria-hidden="true" /> : <span className="select-none text-3xl font-black tracking-tight text-white/35">{initials(label)}</span>}
        </div>
      )}
      <span className="absolute bottom-1 left-1 z-[2] flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white" aria-hidden="true"><Icon className="h-3 w-3" /></span>
    </div>
  );
}
