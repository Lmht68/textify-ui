import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { DemoReadingPage } from './modules/demo-reading/DemoReadingPage';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('The application root is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <DemoReadingPage />
  </StrictMode>,
);
