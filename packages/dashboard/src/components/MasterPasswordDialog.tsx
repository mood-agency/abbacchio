import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  hasEncryptedStorage,
  loadSecureChannels,
  saveSecureChannels,
  clearSecureStorage,
  hasPasswordInSession,
  getPasswordFromSession,
  type SecureChannelConfig,
} from '@/lib/secure-storage';

export type MasterPasswordMode = 'unlock' | 'create' | 'hidden';

interface MasterPasswordDialogProps {
  onUnlock: (password: string, channels: SecureChannelConfig[], saveToSession: boolean) => void;
}

export function MasterPasswordDialog({
  onUnlock,
}: MasterPasswordDialogProps) {
  const { t } = useTranslation('dialogs');
  const [mode, setMode] = useState<MasterPasswordMode>('hidden');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [saveToSession, setSaveToSession] = useState(false);

  // Determine initial mode on mount
  // Only show dialog if encrypted data exists (unlock mode)
  // Create mode is now handled by the onboarding wizard
  useEffect(() => {
    if (hasEncryptedStorage()) {
      // Check if password is already saved in session
      if (hasPasswordInSession()) {
        const sessionPassword = getPasswordFromSession();
        if (sessionPassword) {
          // Auto-unlock with session password
          (async () => {
            setIsLoading(true);
            try {
              const result = await loadSecureChannels(sessionPassword);
              if (result.channels !== null) {
                onUnlock(sessionPassword, result.channels, false);
                setMode('hidden');
                return;
              }
            } catch {
              // Session password invalid, show dialog
            } finally {
              setIsLoading(false);
            }
            setMode('unlock');
          })();
          return;
        }
      }
      setMode('unlock');
    } else {
      // No encrypted storage - onboarding wizard will handle setup
      setMode('hidden');
    }
  }, [onUnlock]);

  const handleUnlock = async () => {
    if (!password) {
      setError(t('masterPassword.wrongPassword'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await loadSecureChannels(password);

      if (result.error || result.channels === null) {
        setError(t('masterPassword.wrongPassword'));
        setIsLoading(false);
        return;
      }

      onUnlock(password, result.channels, saveToSession);
      setMode('hidden');
    } catch {
      setError(t('masterPassword.wrongPassword'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (password.length < 8) {
      setError(t('masterPassword.passwordTooShort'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('masterPassword.passwordMismatch'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await saveSecureChannels([], password);

      if (!result.success) {
        setError(t('masterPassword.encryptionFailed'));
        setIsLoading(false);
        return;
      }

      onUnlock(password, [], saveToSession);
      setMode('hidden');
    } catch {
      setError(t('masterPassword.encryptionFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    clearSecureStorage();
    setShowResetConfirm(false);
    setMode('create');
    setPassword('');
    setConfirmPassword('');
    setError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      if (mode === 'unlock') {
        handleUnlock();
      } else if (mode === 'create') {
        if (password && confirmPassword) {
          handleCreate();
        }
      }
    }
  };

  if (mode === 'hidden') {
    return null;
  }

  const isNewPassword = mode === 'create';

  // Dialog is always open when we reach here (we returned early for 'hidden')
  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {mode === 'unlock' && t('masterPassword.unlockTitle')}
            {mode === 'create' && t('masterPassword.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'unlock' && t('masterPassword.unlockDescription')}
            {mode === 'create' && t('masterPassword.createDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Password field */}
          <div className="space-y-2">
            <label htmlFor="master-password" className="text-sm font-medium">
              {t('masterPassword.passwordLabel')}
            </label>
            <div className="relative">
              <Input
                id="master-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                onKeyDown={handleKeyDown}
                placeholder={t('masterPassword.passwordPlaceholder')}
                className="pr-10"
                autoFocus
                autoComplete={isNewPassword ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Confirm password field (for create/migrate) */}
          {isNewPassword && (
            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium">
                {t('masterPassword.confirmLabel')}
              </label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError('');
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={t('masterPassword.confirmPlaceholder')}
                  className="pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showConfirm ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Save to session checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="save-to-session"
              checked={saveToSession}
              onCheckedChange={(checked) => setSaveToSession(checked === true)}
            />
            <label
              htmlFor="save-to-session"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              {t('masterPassword.saveToSession')}
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('masterPassword.saveToSessionDescription')}
          </p>

          {/* Error message */}
          {error && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </p>
          )}

          {/* Reset option (for unlock mode when password is forgotten) */}
          {mode === 'unlock' && !showResetConfirm && (
            <div className="pt-2 border-t space-y-1">
              <p className="text-xs text-muted-foreground">
                {t('masterPassword.resetStorageDescription')}
              </p>
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="text-sm text-muted-foreground hover:text-destructive underline"
              >
                {t('masterPassword.resetStorage')}
              </button>
            </div>
          )}

          {/* Reset confirmation */}
          {showResetConfirm && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive mb-2">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                {t('masterPassword.resetWarning')}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleReset}
                >
                  {t('masterPassword.reset')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowResetConfirm(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {mode === 'unlock' && (
            <Button onClick={handleUnlock} disabled={isLoading || !password}>
              {isLoading ? '...' : t('masterPassword.unlock')}
            </Button>
          )}
          {mode === 'create' && (
            <Button
              onClick={handleCreate}
              disabled={isLoading || !password || !confirmPassword}
            >
              {isLoading ? '...' : t('masterPassword.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MasterPasswordDialog;
