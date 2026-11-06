import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Register background service worker for push notifications & PWA
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // In development mode, purge any stale Workbox precache that could interfere with Vite ES module imports
    if (import.meta.env?.DEV && 'caches' in window) {
      caches.keys().then((names) => {
        names.forEach((name) => {
          if (name.includes('workbox') || name.includes('precache')) {
            caches.delete(name);
          }
        });
      }).catch(() => {});
    }

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch((err) => {
        console.warn('Service Worker registration note:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallbackTitle="Application Error">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
