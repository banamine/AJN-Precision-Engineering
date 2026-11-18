import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './cockpit.css';
import {installLibraryWording} from './utils/libraryWordingDom';

installLibraryWording(); // display rule: the app says "library", never "archive"

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
