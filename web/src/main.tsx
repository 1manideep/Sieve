import './styles/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { initFirebase } from './app/firebase';
import { BootSplash } from './app/BootSplash';

initFirebase();   // app + auth + AI layer init (App Check). Never Firestore here.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} fallbackElement={<BootSplash />} future={{ v7_startTransition: true }} />
  </StrictMode>
);
