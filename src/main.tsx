import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const root = document.getElementById('root')!;

if (import.meta.env.VITE_AJN_DEMO === '1') {
  void import('./demo/demo-entry').then(({ mountDemo }) => mountDemo(root));
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
