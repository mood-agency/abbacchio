import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
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
    <BrowserRouter>
      <LogViewer />
      <Toaster position="bottom-right" />
    </BrowserRouter>
  );
}

export default App;
