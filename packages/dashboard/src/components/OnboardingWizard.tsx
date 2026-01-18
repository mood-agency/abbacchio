import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeBlock } from '@/components/ui/code-block';
import { SecretKeyInput, isValidKey } from '@/components/ui/secret-key-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LogRow } from './LogRow';
import type { LogEntry, LogLevelLabel } from '../types';
import { decryptLog, isCryptoAvailable } from '../lib/crypto';
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Copy,
  RefreshCw,
  Rocket,
  Eye,
  EyeOff,
  Lock,
  Loader2,
  FileText,
} from 'lucide-react';
import {
  TooltipProvider,
} from '@/components/ui/tooltip';

interface OnboardingWizardProps {
  onComplete: (channelName: string, secretKey: string, masterPassword: string) => void;
}

type Step = 'welcome' | 'channel' | 'installation' | 'password' | 'preview' | 'finish';

function CopyableCodeBlock({
  code,
  language,
}: {
  code: string;
  language: 'javascript' | 'bash' | 'typescript' | 'json' | 'python';
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="relative group">
      <CodeBlock code={code} language={language} />
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-background"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        <span className="sr-only">{t('actions.copy')}</span>
      </Button>
    </div>
  );
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { t } = useTranslation();
  const { t: tOnboarding } = useTranslation('onboarding');
  const { t: tLogs } = useTranslation('logs');

  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [channelName, setChannelName] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [platform, setPlatform] = useState<'nodejs' | 'python' | 'http'>('nodejs');
  const [logger, setLogger] = useState<string>('pino');
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmMasterPassword, setConfirmMasterPassword] = useState('');
  const [showMasterPassword, setShowMasterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { t: tDialogs } = useTranslation('dialogs');

  // Preview step state
  const [previewLogs, setPreviewLogs] = useState<LogEntry[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasReceivedLogsRef = useRef(false);

  // Fire confetti when first log arrives
  const fireConfetti = useCallback(() => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });
  }, []);

  const steps: Step[] = ['welcome', 'channel', 'installation', 'password', 'preview', 'finish'];
  const currentStepIndex = steps.indexOf(currentStep);

  const generateKey = useCallback(async () => {
    setIsGeneratingKey(true);
    try {
      const res = await fetch('/api/generate-key');
      const data = await res.json();
      if (data.key) {
        setSecretKey(data.key);
      }
    } catch (err) {
      console.error('Failed to generate key:', err);
    } finally {
      setIsGeneratingKey(false);
    }
  }, []);

  const copyKey = useCallback(async () => {
    if (!secretKey) return;
    try {
      await navigator.clipboard.writeText(secretKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [secretKey]);

  const validateChannelStep = (): boolean => {
    if (!channelName.trim()) {
      toast.error(tLogs('toast.channelNameRequired'), {
        description: tLogs('toast.channelNameRequiredDescription'),
      });
      return false;
    }
    if (secretKey.trim() && !isValidKey(secretKey.trim())) {
      toast.error(tLogs('toast.invalidKeyFormat'), {
        description: tLogs('toast.invalidKeyDescription'),
      });
      return false;
    }
    return true;
  };

  const validatePasswordStep = (): boolean => {
    if (masterPassword.length < 8) {
      toast.error(tDialogs('masterPassword.passwordTooShort'));
      return false;
    }
    if (masterPassword !== confirmMasterPassword) {
      toast.error(tDialogs('masterPassword.passwordMismatch'));
      return false;
    }
    return true;
  };

  // Log level mapping
  const LOG_LEVELS: Record<number, LogLevelLabel> = {
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
  };

  // Process incoming log entry (decrypt if needed)
  const processLogEntry = useCallback(async (entry: LogEntry): Promise<LogEntry> => {
    if (!entry.encrypted || !entry.encryptedData) {
      return { ...entry, wasEncrypted: false };
    }

    if (!secretKey || !isCryptoAvailable()) {
      return { ...entry, wasEncrypted: true, decryptionFailed: !secretKey };
    }

    try {
      const decrypted = await decryptLog<{
        level?: number;
        time?: number;
        msg?: string;
        message?: string;
        namespace?: string;
        name?: string;
        [key: string]: unknown;
      }>(entry.encryptedData, secretKey);

      if (!decrypted) {
        return { ...entry, wasEncrypted: true, decryptionFailed: true };
      }

      const level = typeof decrypted.level === 'number' ? decrypted.level : 30;
      const { level: _, time, msg, message, namespace, name, ...rest } = decrypted;

      return {
        ...entry,
        level,
        levelLabel: LOG_LEVELS[level as keyof typeof LOG_LEVELS] || 'info',
        time: time || entry.time,
        msg: msg || message || '',
        namespace: namespace || name,
        data: rest,
        encrypted: false,
        encryptedData: undefined,
        wasEncrypted: true,
      };
    } catch {
      return { ...entry, wasEncrypted: true, decryptionFailed: true };
    }
  }, [secretKey]);

  // Connect to the log stream for preview
  const connectToChannel = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setIsConnecting(true);
    setPreviewLogs([]);
    hasReceivedLogsRef.current = false;

    const streamUrl = `/api/logs/stream?channel=${encodeURIComponent(channelName)}`;
    const eventSource = new EventSource(streamUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setIsConnecting(false);
    };

    eventSource.addEventListener('log', async (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data);
        const processed = await processLogEntry(entry);
        // Fire confetti on first log received
        if (!hasReceivedLogsRef.current) {
          hasReceivedLogsRef.current = true;
          fireConfetti();
        }
        setPreviewLogs((prev) => [processed, ...prev].slice(0, 100)); // Keep last 100 logs
      } catch (e) {
        console.error('Failed to parse log event:', e);
      }
    });

    eventSource.addEventListener('batch', async (event) => {
      try {
        const entries: LogEntry[] = JSON.parse(event.data);
        const processed = await Promise.all(entries.map(processLogEntry));
        // Fire confetti on first log received
        if (!hasReceivedLogsRef.current && processed.length > 0) {
          hasReceivedLogsRef.current = true;
          fireConfetti();
        }
        setPreviewLogs((prev) => [...processed.reverse(), ...prev].slice(0, 100));
      } catch (e) {
        console.error('Failed to parse batch event:', e);
      }
    });

    eventSource.onerror = () => {
      setIsConnected(false);
      setIsConnecting(false);
    };
  }, [channelName, processLogEntry, fireConfetti]);

  // Connect when entering preview step
  useEffect(() => {
    if (currentStep === 'preview') {
      connectToChannel();
    } else {
      // Disconnect when leaving preview step
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsConnected(false);
      setIsConnecting(false);
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [currentStep, connectToChannel]);

  const goNext = () => {
    // Validate channel step before proceeding
    if (currentStep === 'channel' && !validateChannelStep()) {
      return;
    }
    // Validate password step before proceeding
    if (currentStep === 'password' && !validatePasswordStep()) {
      return;
    }
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    }
  };

  const goBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex]);
    }
  };

  const handleFinish = () => {
    onComplete(channelName, secretKey, masterPassword);
  };

  const getCodeExample = () => {
    const url = `${window.location.origin}/api/logs`;
    const channel = channelName || 'my-channel';
    const keyPlaceholder = 'YOUR_ENCRYPTION_KEY';

    if (platform === 'nodejs') {
      if (logger === 'pino') {
        return `import pino from "pino";

const logger = pino({
  transport: {
    target: "@abbacchio/transport/pino",
    options: {
      url: "${url}",
      channel: "${channel}",${secretKey ? `
      secretKey: "${keyPlaceholder}",` : ''}
    },
  },
});

logger.info("Hello from Pino!");`;
      } else {
        return `import winston from "winston";
import { AbbacchioWinstonTransport } from "@abbacchio/transport/winston";

const logger = winston.createLogger({
  transports: [
    new AbbacchioWinstonTransport({
      url: "${url}",
      channel: "${channel}",${secretKey ? `
      secretKey: "${keyPlaceholder}",` : ''}
    }),
  ],
});

logger.info("Hello from Winston!");`;
      }
    } else if (platform === 'python') {
      if (logger === 'logging') {
        return `import logging
from abbacchio.logging import AbbacchioHandler

handler = AbbacchioHandler(
    url="${url}",
    channel="${channel}",${secretKey ? `
    secret_key="${keyPlaceholder}",` : ''}
)

logger = logging.getLogger(__name__)
logger.addHandler(handler)
logger.setLevel(logging.DEBUG)

logger.info("Hello from Python!")`;
      } else if (logger === 'loguru') {
        return `from loguru import logger
from abbacchio.loguru import AbbacchioSink

sink = AbbacchioSink(
    url="${url}",
    channel="${channel}",${secretKey ? `
    secret_key="${keyPlaceholder}",` : ''}
)

logger.add(sink, format="{message}", level="DEBUG")

logger.info("Hello from loguru!")`;
      } else {
        return `import structlog
from abbacchio.structlog import AbbacchioProcessor

processor = AbbacchioProcessor(
    url="${url}",
    channel="${channel}",${secretKey ? `
    secret_key="${keyPlaceholder}",` : ''}
)

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        processor,
    ],
)

logger = structlog.get_logger()
logger.info("Hello from structlog!")`;
      }
    } else {
      return `curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -H "X-Channel: ${channel}" \\
  -d '{"level":30,"msg":"Hello from curl!"}'`;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Progress bar */}
      <div className="w-full bg-muted h-1">
        <div
          className="bg-primary h-1 transition-all duration-300"
          style={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center px-6 py-12 overflow-y-auto">
        <div className="w-full max-w-2xl">
          {/* Step 1: Welcome */}
          {currentStep === 'welcome' && (
            <div className="text-center animate-in fade-in duration-300">
              <div className="text-7xl mb-6">📡</div>
              <h1 className="text-4xl font-bold text-foreground mb-3">
                {tOnboarding('welcome.title')}
              </h1>
              <p className="text-xl text-muted-foreground mb-4">
                {tOnboarding('welcome.subtitle')}
              </p>
              <p className="text-muted-foreground max-w-lg mx-auto mb-8">
                {tOnboarding('welcome.description')}
              </p>

              {/* Features */}
              <div className="grid grid-cols-2 gap-4 mb-10 max-w-md mx-auto">
                <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl mb-2">⚡</div>
                  <span className="text-sm font-medium">{tOnboarding('welcome.features.realtime')}</span>
                </div>
                <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl mb-2">📺</div>
                  <span className="text-sm font-medium">{tOnboarding('welcome.features.multiChannel')}</span>
                </div>
                <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl mb-2">🔐</div>
                  <span className="text-sm font-medium">{tOnboarding('welcome.features.encryption')}</span>
                </div>
                <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
                  <div className="text-2xl mb-2">🔍</div>
                  <span className="text-sm font-medium">{tOnboarding('welcome.features.filtering')}</span>
                </div>
              </div>

              <Button size="lg" onClick={goNext} className="px-8">
                {tOnboarding('welcome.getStarted')}
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          )}

          {/* Step 2: Channel Setup */}
          {currentStep === 'channel' && (
            <div className="animate-in fade-in duration-300">
              <div className="text-center mb-8">
                <div className="text-5xl mb-4">🔌</div>
                <h2 className="text-3xl font-bold text-foreground mb-2">
                  {tOnboarding('channel.title')}
                </h2>
                <p className="text-muted-foreground">
                  {tOnboarding('channel.description')}
                </p>
              </div>

              <div className="space-y-6 max-w-md mx-auto">
                {/* Channel name */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{tOnboarding('channel.channelName')}</label>
                  <Input
                    type="text"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    placeholder={tOnboarding('channel.channelPlaceholder')}
                    className="text-lg h-12"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    {tOnboarding('channel.channelHint')}
                  </p>
                </div>

                {/* Encryption key */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">
                      {tOnboarding('channel.encryptionKey')}{' '}
                      <span className="text-muted-foreground font-normal">({t('labels.optional')})</span>
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <SecretKeyInput
                      value={secretKey}
                      onChange={setSecretKey}
                      placeholder={tOnboarding('channel.keyPlaceholder')}
                      className="flex-1"
                    />
                    {secretKey ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={copyKey}
                        className="shrink-0"
                      >
                        {copiedKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={generateKey}
                        disabled={isGeneratingKey}
                        className="shrink-0"
                      >
                        <RefreshCw className={`w-4 h-4 mr-2 ${isGeneratingKey ? 'animate-spin' : ''}`} />
                        {tOnboarding('channel.generateKey')}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tOnboarding('channel.keyHint')}
                  </p>
                </div>
              </div>

              {/* Navigation */}
              <div className="flex justify-between mt-10 max-w-md mx-auto">
                <Button variant="ghost" onClick={goBack}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  {t('actions.back')}
                </Button>
                <Button onClick={goNext}>
                  {t('actions.continue')}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Installation */}
          {currentStep === 'installation' && (
            <div className="animate-in fade-in duration-300">
              <div className="text-center mb-8">
                <div className="text-5xl mb-4">📦</div>
                <h2 className="text-3xl font-bold text-foreground mb-2">
                  {tOnboarding('installation.title')}
                </h2>
                <p className="text-muted-foreground">
                  {tOnboarding('installation.description')}
                </p>
              </div>

              {/* Platform tabs */}
              <Tabs
                value={platform}
                onValueChange={(v) => {
                  setPlatform(v as typeof platform);
                  // Reset logger when switching platform
                  if (v === 'nodejs') setLogger('pino');
                  else if (v === 'python') setLogger('logging');
                  else setLogger('');
                }}
                className="mb-6"
              >
                <TabsList className="w-full">
                  <TabsTrigger value="nodejs" className="flex-1">Node.js</TabsTrigger>
                  <TabsTrigger value="python" className="flex-1">Python</TabsTrigger>
                  <TabsTrigger value="http" className="flex-1">HTTP</TabsTrigger>
                </TabsList>

                <TabsContent value="nodejs" className="mt-4">
                  <div className="bg-muted/50 rounded-lg p-4 mb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      {tOnboarding('installation.install')}
                    </p>
                    <CopyableCodeBlock code="npm install @abbacchio/transport" language="bash" />
                  </div>
                  <Tabs value={logger} onValueChange={setLogger}>
                    <TabsList className="w-full">
                      <TabsTrigger value="pino" className="flex-1">Pino</TabsTrigger>
                      <TabsTrigger value="winston" className="flex-1">Winston</TabsTrigger>
                    </TabsList>
                    <TabsContent value="pino" className="bg-muted/50 rounded-lg p-4 mt-2">
                      <CopyableCodeBlock language="javascript" code={getCodeExample()} />
                    </TabsContent>
                    <TabsContent value="winston" className="bg-muted/50 rounded-lg p-4 mt-2">
                      <CopyableCodeBlock language="javascript" code={getCodeExample()} />
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                <TabsContent value="python" className="mt-4">
                  <div className="bg-muted/50 rounded-lg p-4 mb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      {tOnboarding('installation.install')}
                    </p>
                    <CopyableCodeBlock code="pip install abbacchio" language="bash" />
                  </div>
                  <Tabs value={logger} onValueChange={setLogger}>
                    <TabsList className="w-full">
                      <TabsTrigger value="logging" className="flex-1">logging</TabsTrigger>
                      <TabsTrigger value="loguru" className="flex-1">loguru</TabsTrigger>
                      <TabsTrigger value="structlog" className="flex-1">structlog</TabsTrigger>
                    </TabsList>
                    <TabsContent value="logging" className="bg-muted/50 rounded-lg p-4 mt-2">
                      <CopyableCodeBlock language="python" code={getCodeExample()} />
                    </TabsContent>
                    <TabsContent value="loguru" className="bg-muted/50 rounded-lg p-4 mt-2">
                      <CopyableCodeBlock language="python" code={getCodeExample()} />
                    </TabsContent>
                    <TabsContent value="structlog" className="bg-muted/50 rounded-lg p-4 mt-2">
                      <CopyableCodeBlock language="python" code={getCodeExample()} />
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                <TabsContent value="http" className="mt-4">
                  <p className="text-sm text-muted-foreground mb-3">
                    {tOnboarding('installation.httpDescription')}
                  </p>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <CopyableCodeBlock language="bash" code={getCodeExample()} />
                  </div>
                </TabsContent>
              </Tabs>

              {/* Navigation */}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={goBack}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  {t('actions.back')}
                </Button>
                <Button onClick={goNext}>
                  {t('actions.continue')}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Password */}
          {currentStep === 'password' && (
            <div className="animate-in fade-in duration-300">
              <div className="text-center mb-8">
                <div className="text-5xl mb-4">🔐</div>
                <h2 className="text-3xl font-bold text-foreground mb-2">
                  {tOnboarding('password.title')}
                </h2>
                <p className="text-muted-foreground">
                  {tOnboarding('password.description')}
                </p>
              </div>

              {/* Master password section */}
              <div className="max-w-md mx-auto space-y-6 mb-8">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                    <label className="text-sm font-medium">{tOnboarding('password.masterPassword')}</label>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {tOnboarding('password.masterPasswordHint')}
                  </p>
                  <div className="relative">
                    <Input
                      type={showMasterPassword ? 'text' : 'password'}
                      value={masterPassword}
                      onChange={(e) => setMasterPassword(e.target.value)}
                      placeholder={tOnboarding('password.passwordPlaceholder')}
                      className="pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowMasterPassword(!showMasterPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showMasterPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">{tOnboarding('password.confirmPassword')}</label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmMasterPassword}
                      onChange={(e) => setConfirmMasterPassword(e.target.value)}
                      placeholder={tOnboarding('password.confirmPlaceholder')}
                      className="pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <div className="flex justify-between max-w-md mx-auto">
                <Button variant="ghost" onClick={goBack}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  {t('actions.back')}
                </Button>
                <Button onClick={goNext}>
                  {t('actions.continue')}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: Preview */}
          {currentStep === 'preview' && (
            <TooltipProvider>
              <div className="animate-in fade-in duration-300">
                <div className="text-center mb-6">
                  <div className="text-5xl mb-4">📊</div>
                  <h2 className="text-3xl font-bold text-foreground mb-2">
                    {tOnboarding('preview.title')}
                  </h2>
                  <p className="text-muted-foreground">
                    {tOnboarding('preview.description')}
                  </p>
                  <div className="mt-3">
                    <span className="text-sm text-muted-foreground">{tOnboarding('installation.channel')}: </span>
                    <code className="bg-muted px-3 py-1 rounded text-sm font-medium">{channelName}</code>
                  </div>
                </div>

                {/* Log table */}
                <div className="border rounded-lg overflow-hidden bg-background mb-6">
                  {/* Column headers */}
                  <div className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-muted-foreground tracking-wider border-b border-border bg-muted">
                    <span className="w-36 flex-shrink-0">Date/Time</span>
                    <span className="w-5 flex-shrink-0"></span>
                    <span className="w-16 flex-shrink-0">Level</span>
                    <span className="w-28 flex-shrink-0">Namespace</span>
                    <span className="w-48 flex-shrink-0">Message</span>
                    <span className="flex-1">Data</span>
                  </div>

                  {/* Log rows */}
                  <ScrollArea className="h-[300px]" viewPortRef={scrollContainerRef}>
                    {previewLogs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full min-h-[280px] text-muted-foreground">
                        {isConnecting ? (
                          <>
                            <Loader2 className="w-12 h-12 mb-3 opacity-50 animate-spin" />
                            <p className="text-sm">{tOnboarding('preview.connecting')}</p>
                          </>
                        ) : (
                          <>
                            <FileText className="w-12 h-12 mb-3 opacity-50" />
                            <p className="text-sm">{tOnboarding('preview.waitingForLogs')}</p>
                            <p className="text-xs mt-1 text-muted-foreground/70">{tOnboarding('preview.waitingHint')}</p>
                          </>
                        )}
                      </div>
                    ) : (
                      previewLogs.map((log) => (
                        <LogRow
                          key={log.id}
                          log={log}
                          showChannel={false}
                        />
                      ))
                    )}
                  </ScrollArea>
                </div>

                {/* Navigation */}
                <div className="flex justify-between max-w-md mx-auto">
                  <Button variant="ghost" onClick={goBack}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t('actions.back')}
                  </Button>
                  <Button onClick={goNext}>
                    {t('actions.continue')}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            </TooltipProvider>
          )}

          {/* Step 6: Finish */}
          {currentStep === 'finish' && (
            <div className="text-center animate-in fade-in duration-300">
              <div className="text-7xl mb-6">🎉</div>
              <h2 className="text-3xl font-bold text-foreground mb-3">
                {tOnboarding('finish.title')}
              </h2>
              <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                {tOnboarding('finish.description', { channel: channelName })}
              </p>

              {/* Summary card */}
              <div className="bg-muted/30 rounded-lg p-6 mb-8 max-w-md mx-auto text-left">
                <h3 className="font-medium mb-4">{tOnboarding('finish.summary')}</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{tOnboarding('installation.channel')}</span>
                    <code className="bg-muted px-2 py-0.5 rounded">{channelName}</code>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{tOnboarding('finish.encryption')}</span>
                    <span>{secretKey ? '✓ ' + tOnboarding('finish.enabled') : tOnboarding('finish.disabled')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{tOnboarding('finish.platform')}</span>
                    <span>{platform === 'nodejs' ? 'Node.js' : platform === 'python' ? 'Python' : 'HTTP'}</span>
                  </div>
                </div>
              </div>

              {/* Navigation */}
              <div className="flex justify-center gap-4">
                <Button variant="ghost" onClick={goBack}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  {t('actions.back')}
                </Button>
                <Button size="lg" onClick={handleFinish} className="px-8">
                  <Rocket className="w-5 h-5 mr-2" />
                  {tOnboarding('finish.startMonitoring')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex justify-center gap-2 pb-8">
        {steps.map((step, index) => (
          <div
            key={step}
            className={`w-2 h-2 rounded-full transition-colors ${
              index <= currentStepIndex ? 'bg-primary' : 'bg-muted'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
