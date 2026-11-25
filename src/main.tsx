import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './cockpit.css';
import {installLibraryWording} from './utils/libraryWordingDom';

type StaleReload = { ajnTryStaleReload?: () => boolean };
const tryStaleReload = () => (window as unknown as StaleReload).ajnTryStaleReload?.() ?? false;
// A code-split view failed to load (old hash gone after a deploy): reload once; if the guard says no, let the error surface.
window.addEventListener('vite:preloadError', (event) => { if (tryStaleReload()) event.preventDefault(); });
window.addEventListener('unhandledrejection', (event) => {
  if (/dynamically imported module|Importing a module script failed/i.test(String((event.reason as Error | undefined)?.message ?? event.reason))) tryStaleReload();
});
// Booted cleanly for 30 s: forget the marker so the next deploy can recover this tab again.
window.setTimeout(() => { try { sessionStorage.removeItem('ajn-stale-reload-at'); } catch { /* storage unavailable */ } }, 30000);

installLibraryWording(); // display rule: the app says "library", never "archive"

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
