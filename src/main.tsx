import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/globals.css';
import { LandingPage } from './pages/Landing';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('The application root is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
