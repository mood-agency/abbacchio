import { useEffect, useCallback, useMemo } from 'react';
import { BrowserRouter, useSearchParams } from 'react-router-dom';
import { LogViewer } from './components/LogViewer';
import { Toaster } from './components/ui/sonner';

type ViewType = 'logs' | 'metrics' | 'traces';
const VALID_VIEWS: ViewType[] = ['logs', 'metrics', 'traces'];

function AppContent() {
  // Initialize dark mode from system preference
  useEffect(() => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const [searchParams, setSearchParams] = useSearchParams();

  const activeView = useMemo<ViewType>(() => {
    const param = searchParams.get('view');
    return param && VALID_VIEWS.includes(param as ViewType) ? (param as ViewType) : 'logs';
  }, [searchParams]);

  const setActiveView = useCallback((view: ViewType) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (view === 'logs') {
        next.delete('view');
      } else {
        next.set('view', view);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return (
    <>
      <LogViewer activeView={activeView} onViewChange={setActiveView} />
      <Toaster position="bottom-right" />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
