import { useState, useCallback } from 'react';
import { Input } from './input';
import { Button } from './button';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

interface SecretKeyInputProps {
  value: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  autoFocus?: boolean;
}

/**
 * Validates if a string contains only valid base64url characters.
 * Used during typing to allow incremental input.
 */
function hasValidKeyChars(key: string): boolean {
  if (!key) return true;
  const base64urlRegex = /^[A-Za-z0-9_-]+$/;
  return base64urlRegex.test(key);
}

/**
 * Validates if a string is a complete, valid base64url encryption key.
 * Format: 43 characters of alphanumeric + underscore + hyphen (256-bit key)
 */
export function isValidKey(key: string): boolean {
  if (!key) return true; // Empty is valid (optional field)
  // Must be exactly 43 chars for a 256-bit key in base64url
  if (key.length !== 43) return false;
  const base64urlRegex = /^[A-Za-z0-9_-]+$/;
  return base64urlRegex.test(key);
}

/**
 * Masks a key showing only the first 4 characters followed by bullets.
 * The number of bullets matches the actual hidden characters.
 */
function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 4) return key;
  return key.slice(0, 4) + '•'.repeat(key.length - 4);
}

/**
 * A secure input for encryption keys that shows first 4 chars + masked rest,
 * with a toggle to reveal the full key.
 *
 * Behavior:
 * - Hidden (default): Shows first 4 chars + bullets matching real length
 * - Visible (eye clicked): Shows the full key as plain text
 * - While focused: Shows real value for editing, masks on blur
 * - Validates pasted content is base64url format
 */
export function SecretKeyInput({
  value,
  onChange,
  onKeyDown,
  placeholder = 'Enter encryption key...',
  readOnly = false,
  className = '',
  autoFocus = false,
}: SecretKeyInputProps) {
  const [showFull, setShowFull] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      // Allow typing if characters are valid (length check happens on save)
      if (hasValidKeyChars(newValue)) {
        onChange?.(newValue);
      } else {
        toast.error('Invalid key format', {
          description: 'Key must contain only letters, numbers, hyphens, and underscores',
        });
      }
    },
    [onChange]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const pastedText = e.clipboardData.getData('text').trim();
      // On paste, validate it's a complete valid key
      if (!isValidKey(pastedText)) {
        e.preventDefault();
        toast.error('Invalid key format', {
          description: 'Key must be exactly 43 characters (base64url encoded)',
        });
      }
    },
    []
  );

  const toggleVisibility = useCallback(() => {
    setShowFull((prev) => !prev);
  }, []);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  // Determine what to display:
  // - showFull (eye clicked): always show real value
  // - focused + editable: show real value for editing
  // - otherwise: show masked (first 4 + bullets)
  const shouldShowReal = showFull || (isFocused && !readOnly);

  return (
    <div className={`relative ${className}`}>
      {shouldShowReal ? (
        <Input
          type="text"
          value={value}
          onChange={readOnly ? undefined : handleChange}
          onPaste={readOnly ? undefined : handlePaste}
          onKeyDown={onKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          readOnly={readOnly}
          autoFocus={autoFocus}
          className="font-mono text-sm pr-10"
        />
      ) : (
        <Input
          type="text"
          value={maskKey(value)}
          onFocus={handleFocus}
          onPaste={readOnly ? undefined : handlePaste}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          readOnly
          className="font-mono text-sm pr-10 cursor-text"
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={toggleVisibility}
        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
        tabIndex={-1}
      >
        {showFull ? (
          <EyeOff className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
        ) : (
          <Eye className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
        )}
      </Button>
    </div>
  );
}
