import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import {
  saveSecureChannels,
  hasEncryptedStorage,
  hasLegacyStorage,
  type SecureChannelConfig,
} from '@/lib/secure-storage';

interface SecureStorageContextValue {
  /** Whether secure storage is ready (unlocked or no persistence) */
  isReady: boolean;
  /** Whether persistence is enabled */
  persistenceEnabled: boolean;
  /** Master password (only in memory, never persisted) */
  masterPassword: string | null;
  /** Initial channels loaded from secure storage */
  initialChannels: SecureChannelConfig[];
  /** Set the master password after unlock */
  setMasterPassword: (password: string | null) => void;
  /** Set initial channels after unlock */
  setInitialChannels: (channels: SecureChannelConfig[]) => void;
  /** Mark storage as ready (unlocked or skipped) */
  setReady: (ready: boolean) => void;
  /** Enable/disable persistence */
  setPersistenceEnabled: (enabled: boolean) => void;
  /** Save channels to secure storage */
  saveChannels: (channels: SecureChannelConfig[]) => Promise<boolean>;
  /** Check if encrypted storage exists */
  hasExistingStorage: () => boolean;
  /** Check if legacy (unencrypted) storage exists */
  hasLegacyData: () => boolean;
}

const SecureStorageContext = createContext<SecureStorageContextValue | null>(null);

export function SecureStorageProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [persistenceEnabled, setPersistenceEnabled] = useState(true);
  const [masterPassword, setMasterPassword] = useState<string | null>(null);
  const [initialChannels, setInitialChannels] = useState<SecureChannelConfig[]>([]);

  const saveChannels = useCallback(async (channels: SecureChannelConfig[]): Promise<boolean> => {
    if (!persistenceEnabled || !masterPassword) {
      return true; // Not persisting, but consider it a success
    }

    try {
      const result = await saveSecureChannels(channels, masterPassword);
      return result.success;
    } catch (e) {
      console.error('[SecureStorage] Failed to save channels:', e);
      return false;
    }
  }, [persistenceEnabled, masterPassword]);

  const hasExistingStorage = useCallback(() => {
    return hasEncryptedStorage();
  }, []);

  const hasLegacyData = useCallback(() => {
    return hasLegacyStorage();
  }, []);

  const value: SecureStorageContextValue = {
    isReady,
    persistenceEnabled,
    masterPassword,
    initialChannels,
    setMasterPassword,
    setInitialChannels,
    setReady: setIsReady,
    setPersistenceEnabled,
    saveChannels,
    hasExistingStorage,
    hasLegacyData,
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
