import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support: cached static assets + app shell only (see public/sw.js).
// Production builds only, so Vite HMR / the AI Studio dev preview are never
// intercepted. BASE_URL keeps the scope correct under a sub-path deploy.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker
      .register(`${base}sw.js`, {scope: base})
      .catch((err: unknown) => {
        // Explicit, truthful failure: the app keeps working online without the SW.
        console.error('[sw] registration failed', err);
      });
  });
}
