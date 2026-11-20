// Mounts the panel with the bundled fonts (OFL, no remote font link: the CSP forbids it, 50 section 8).
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './panel.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { chromePanelApi } from './usePanelPort';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App api={chromePanelApi()} />
    </StrictMode>,
  );
}
