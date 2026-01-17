import { useEffect } from 'react';
import { LogViewer } from './components/LogViewer';
import { Toaster } from './components/ui/sonner';

function App() {
  // Initialize dark mode from system preference
  useEffect(() => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  return (
    <>
      <LogViewer />
      <Toaster position="bottom-right" />
    </>
  );
}

export default App;
