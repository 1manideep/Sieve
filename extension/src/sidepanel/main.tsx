// Mounts the panel. No font files are bundled and no remote font link is allowed (the CSP forbids it, 50 section
// 8): the stack in panel.css uses 'Google Sans' when it is installed and system-ui otherwise. The surface (popup or
// side panel) is set on <html> before the first render, so the popup lays out at 400 px from its first frame.
import './panel.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { chromePanelApi } from './usePanelPort';

const api = chromePanelApi();
document.documentElement.dataset.surface = api.surface ?? 'panel';
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App api={api} />
    </StrictMode>,
  );
}
