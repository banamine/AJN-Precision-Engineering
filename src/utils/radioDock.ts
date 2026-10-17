// One tiny switch so any page (Live, header, player) can open the Radio dock without importing it.
export const RADIO_DOCK_EVENT = 'ajn:radio-dock';
export type RadioDockAction = 'open' | 'close' | 'toggle';

export function requestRadioDock(action: RadioDockAction = 'open'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<RadioDockAction>(RADIO_DOCK_EVENT, { detail: action }));
}
