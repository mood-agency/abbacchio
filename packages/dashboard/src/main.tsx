import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './i18n';
import { initSelfLogger } from './lib/self-logger';

// Initialize self-logging to send dashboard logs to Abbacchio API
// You can view these logs in the 'dashboard-logs' channel
// Configure via .env: VITE_API_URL, VITE_SELF_LOG_CHANNEL, VITE_SELF_LOG_ENABLED
initSelfLogger({
  url: import.meta.env.VITE_API_URL || '/api/logs',
  channel: import.meta.env.VITE_SELF_LOG_CHANNEL || 'dashboard-logs',
  enabled: import.meta.env.VITE_SELF_LOG_ENABLED !== 'false',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <App />
    </Suspense>
  </StrictMode>
);
