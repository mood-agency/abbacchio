import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import {
  saveSecureChannels,
  hasEncryptedStorage,
  savePasswordToSession,
  getPasswordFromSession,
  hasPasswordInSession,
  clearPasswordFromSession,
  type SecureChannelConfig,
} from '@/lib/secure-storage';

interface SecureStorageContextValue {
  /** Whether secure storage is ready (unlocked) */
  isReady: boolean;
  /** Master password (only in memory, never persisted) */
  masterPassword: string | null;
  /** Initial channels loaded from secure storage */
  initialChannels: SecureChannelConfig[];
  /** Whether password is saved in session storage */
  isPasswordInSession: boolean;
  /** Set the master password after unlock */
  setMasterPassword: (password: string | null) => void;
  /** Set initial channels after unlock */
  setInitialChannels: (channels: SecureChannelConfig[]) => void;
  /** Mark storage as ready (unlocked) */
  setReady: (ready: boolean) => void;
  /** Save channels to secure storage */
  saveChannels: (channels: SecureChannelConfig[]) => Promise<boolean>;
  /** Check if encrypted storage exists */
  hasExistingStorage: () => boolean;
  /** Save password to session storage */
  saveToSession: (password: string) => void;
  /** Clear password from session storage */
  clearFromSession: () => void;
  /** Get password from session if available */
  getSessionPassword: () => string | null;
}

const SecureStorageContext = createContext<SecureStorageContextValue | null>(null);

export function SecureStorageProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [masterPassword, setMasterPassword] = useState<string | null>(null);
  const [initialChannels, setInitialChannels] = useState<SecureChannelConfig[]>([]);
  const [isPasswordInSession, setIsPasswordInSession] = useState(hasPasswordInSession());

  const saveChannels = useCallback(async (channels: SecureChannelConfig[]): Promise<boolean> => {
    if (!masterPassword) {
      return false;
    }

    try {
      const result = await saveSecureChannels(channels, masterPassword);
      return result.success;
    } catch (e) {
      console.error('[SecureStorage] Failed to save channels:', e);
      return false;
    }
  }, [masterPassword]);

  const hasExistingStorage = useCallback(() => {
    return hasEncryptedStorage();
  }, []);

  const saveToSession = useCallback((password: string) => {
    savePasswordToSession(password);
    setIsPasswordInSession(true);
  }, []);

  const clearFromSession = useCallback(() => {
    clearPasswordFromSession();
    setIsPasswordInSession(false);
  }, []);

  const getSessionPassword = useCallback(() => {
    return getPasswordFromSession();
  }, []);

  const value: SecureStorageContextValue = {
    isReady,
    masterPassword,
    initialChannels,
    isPasswordInSession,
    setMasterPassword,
    setInitialChannels,
    setReady: setIsReady,
    saveChannels,
    hasExistingStorage,
    saveToSession,
    clearFromSession,
    getSessionPassword,
  };

  return (
    <SecureStorageContext.Provider value={value}>
      {children}
    </SecureStorageContext.Provider>
  );
}

export function useSecureStorage(): SecureStorageContextValue {
  const context = useContext(SecureStorageContext);
  if (!context) {
    throw new Error('useSecureStorage must be used within a SecureStorageProvider');
  }
  return context;
}
