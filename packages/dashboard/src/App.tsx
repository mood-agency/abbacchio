import { useEffect, useCallback } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { LogViewer } from './components/LogViewer';
import { Toaster } from './components/ui/sonner';
import { SecureStorageProvider, useSecureStorage } from './contexts/SecureStorageContext';
import { MasterPasswordDialog } from './components/MasterPasswordDialog';
import type { SecureChannelConfig } from './lib/secure-storage';

function AppContent() {
  const { setReady, setMasterPassword, setInitialChannels, setPersistenceEnabled } = useSecureStorage();

  // Initialize dark mode from system preference
  useEffect(() => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const handleUnlock = useCallback((password: string, channels: SecureChannelConfig[]) => {
    setMasterPassword(password);
    setInitialChannels(channels);
    setPersistenceEnabled(true);
    setReady(true);
  }, [setMasterPassword, setInitialChannels, setPersistenceEnabled, setReady]);

  const handleSkipPersistence = useCallback(() => {
    setMasterPassword(null);
    setInitialChannels([]);
    setPersistenceEnabled(false);
    setReady(true);
  }, [setMasterPassword, setInitialChannels, setPersistenceEnabled, setReady]);

  return (
    <>
      <MasterPasswordDialog
        onUnlock={handleUnlock}
        onSkipPersistence={handleSkipPersistence}
      />
      <LogViewer />
      <Toaster position="bottom-right" />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <SecureStorageProvider>
        <AppContent />
      </SecureStorageProvider>
    </BrowserRouter>
  );
}

export default App;
