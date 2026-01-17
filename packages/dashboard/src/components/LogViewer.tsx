import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLogStream } from '../hooks/useLogStream';
import { FilterBar } from './FilterBar';
import { LogRow } from './LogRow';
import type { FilterLevel } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeBlock } from '@/components/ui/code-block';
import {
  Key,
  Link,
  Sun,
  Moon,
  ArrowDown,
  RefreshCw,
  Copy,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  FileText,
  Loader2,
  Trash2,
} from 'lucide-react';

export function LogViewer() {
  const {
    logs,
    isConnected,
    isConnecting,
    clearLogs,
    connectionError,
    secretKey,
    hasEncryptedLogs,
    channels,
    urlChannel,
  } = useLogStream();

  // If no channel is provided, show a friendly message
  if (!urlChannel) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-6">🕵️</div>
          <h1 className="text-2xl font-bold text-foreground mb-4">
            Whoa there, secret agent!
          </h1>
          <p className="text-muted-foreground mb-6">
            You need a <span className="font-mono text-primary">channel</span> and a <span className="font-mono text-primary">key</span> to tune into the logs.
            Without them, you're just staring at a blank wall... which is less fun than it sounds.
          </p>
          <div className="bg-muted rounded-lg p-4 text-left font-mono text-sm">
            <p className="text-muted-foreground mb-2"># Try something like:</p>
            <a
              href="/?channel=myapp&key=supersecret"
              className="text-foreground hover:underline block"
            >
              {window.location.origin}/?channel=<span className="text-green-500">myapp</span>&key=<span className="text-yellow-500">supersecret</span>
            </a>
          </div>
          <p className="text-muted-foreground text-sm mt-6">
            No key? No logs. It's like a secret club, but for debugging. 🔐
          </p>
        </div>
      </div>
    );
  }

  // Theme state
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  // Key generator dialog
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showFullKey, setShowFullKey] = useState(false);

  // Mask key showing only first 4 characters
  const maskedKey = generatedKey
    ? generatedKey.slice(0, 4) + '*'.repeat(Math.max(0, generatedKey.length - 4))
    : '';

  const generateNewKey = async () => {
    setIsGeneratingKey(true);
    setShowFullKey(false);
    try {
      const res = await fetch('/api/generate-key');
      const data = await res.json();
      if (data.key) {
        setGeneratedKey(data.key);
      }
    } catch (err) {
      console.error('Failed to generate key:', err);
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const copyKey = async () => {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Auto-generate key when dialog opens
  const openKeyDialog = async () => {
    setShowKeyDialog(true);
    setCopiedKey(false);
    await generateNewKey();
  };

  // Copy full link with channel and key
  const [copiedLink, setCopiedLink] = useState(false);
  const copyLink = async () => {
    const params = new URLSearchParams();
    if (channelFilter) params.set('channel', channelFilter);
    if (secretKey) params.set('key', secretKey);
    const query = params.toString();
    const link = `${window.location.origin}${window.location.pathname}${query ? '?' + query : ''}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  // Filter state
  const [levelFilter, setLevelFilter] = useState<FilterLevel>('all');
  const channelFilter = urlChannel;
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Auto-scroll state
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevLogCountRef = useRef(0);

  // Extract unique namespaces from logs
  const availableNamespaces = useMemo(() => {
    const namespaces = new Set<string>();
    for (const log of logs) {
      if (log.namespace) {
        namespaces.add(log.namespace);
      }
    }
    return Array.from(namespaces).sort();
  }, [logs]);

  // Filter logs (oldest first, newest last - like a console)
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Level filter
      if (levelFilter !== 'all' && log.levelLabel !== levelFilter) {
        return false;
      }

      // Channel filter
      if (channelFilter && !log.channel?.toLowerCase().includes(channelFilter.toLowerCase())) {
        return false;
      }

      // Namespace filter (also searches channel as fallback)
      if (namespaceFilter) {
        const filterLower = namespaceFilter.toLowerCase();
        const namespaceMatch = log.namespace?.toLowerCase().includes(filterLower);
        const channelMatch = log.channel?.toLowerCase().includes(filterLower);
        if (!namespaceMatch && !channelMatch) {
          return false;
        }
      }

      // Search filter
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        const msgMatch = log.msg.toLowerCase().includes(searchLower);
        const namespaceMatch = log.namespace?.toLowerCase().includes(searchLower);
        const channelMatch = log.channel?.toLowerCase().includes(searchLower);
        const dataMatch = JSON.stringify(log.data).toLowerCase().includes(searchLower);
        if (!msgMatch && !namespaceMatch && !channelMatch && !dataMatch) {
          return false;
        }
      }

      return true;
    });
  }, [logs, levelFilter, channelFilter, namespaceFilter, searchQuery]);

  // Count total search matches across all filtered logs
  const matchCount = useMemo(() => {
    if (!searchQuery) return 0;
    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');

    let count = 0;
    for (const log of filteredLogs) {
      const msgMatches = log.msg.match(regex);
      const dataMatches = JSON.stringify(log.data).match(regex);
      count += (msgMatches?.length || 0) + (dataMatches?.length || 0);
    }
    return count;
  }, [filteredLogs, searchQuery]);

  // Virtualization for performance with large log lists
  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 36, // Estimated row height in pixels
    overscan: 20, // Render extra rows outside viewport for smoother scrolling
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  // Auto-scroll to bottom when new logs arrive (like a console)
  useEffect(() => {
    if (autoScroll && logs.length > prevLogCountRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    prevLogCountRef.current = logs.length;
  }, [logs.length, autoScroll]);

  // Detect user scroll - check if at bottom
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-background relative z-20">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <h1 className="text-lg font-semibold text-foreground">Abbacchio</h1>
              {urlChannel && (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-lg font-semibold text-foreground">{urlChannel}</span>
                </>
              )}
            </div>

          </div>

          <div className="flex items-center gap-1">
            {/* Clear logs */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearLogs}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear all logs</TooltipContent>
            </Tooltip>

            {/* Key generator button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={openKeyDialog}
                  className={
                    secretKey
                      ? 'text-green-600 dark:text-green-400'
                      : hasEncryptedLogs
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : ''
                  }
                >
                  <Key className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Generate encryption key</TooltipContent>
            </Tooltip>

            {/* Copy link button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={copyLink}>
                  {copiedLink ? (
                    <Check className="w-5 h-5 text-green-500" />
                  ) : (
                    <Link className="w-5 h-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy link with channel and key</TooltipContent>
            </Tooltip>

            {/* Theme toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    document.documentElement.classList.toggle('dark');
                    setIsDark(!isDark);
                  }}
                >
                  {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle dark mode</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* Filter bar */}
        <FilterBar
          levelFilter={levelFilter}
          setLevelFilter={setLevelFilter}
          namespaceFilter={namespaceFilter}
          setNamespaceFilter={setNamespaceFilter}
          availableNamespaces={availableNamespaces}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          logCount={logs.length}
          filteredCount={filteredLogs.length}
          matchCount={matchCount}
        />

        {/* Column headers */}
        <div className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted relative z-10">
          <span className="w-24 flex-shrink-0">Time</span>
          <span className="w-16 flex-shrink-0">Level</span>
          {channels.length > 1 && !channelFilter && (
            <span className="w-24 flex-shrink-0">Channel</span>
          )}
          <span className="w-28 flex-shrink-0">Namespace</span>
          <span className="w-48 flex-shrink-0">Message</span>
          <span className="flex-1">Data</span>
        </div>

        {/* Log list */}
        <ScrollArea
          className="flex-1"
          viewPortRef={scrollContainerRef}
          onScrollCapture={handleScroll}
        >
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-muted-foreground">
              {!isConnected && !isConnecting ? (
                <>
                  <AlertTriangle className="w-16 h-16 mb-4 text-destructive opacity-70" />
                  <p className="text-lg text-destructive">Connection failed</p>
                  <p className="text-sm mt-1">{connectionError || 'Unable to connect to the server'}</p>
                  <p className="text-xs mt-2 text-muted-foreground">Check if the server is running</p>
                </>
              ) : isConnecting ? (
                <>
                  <Loader2 className="w-16 h-16 mb-4 opacity-50 animate-spin" />
                  <p className="text-lg">Connecting...</p>
                </>
              ) : (
                <div className="text-center w-[625px] px-6 py-8">
                  <FileText className="w-16 h-16 mb-4 opacity-50 mx-auto" />
                  <p className="text-lg font-medium">No logs yet</p>
                  <p className="text-sm mt-1 mb-6">Send logs from your application using one of the methods below</p>

                  <div className="text-left mb-4 bg-muted/50 rounded-lg p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Install</p>
                    <CodeBlock code="npm install @abbacchio/transport" language="bash" />
                  </div>

                  <Tabs defaultValue="pino" className="text-left">
                    <TabsList className="w-full">
                      <TabsTrigger value="pino" className="flex-1">Pino</TabsTrigger>
                      <TabsTrigger value="winston" className="flex-1">Winston</TabsTrigger>
                      <TabsTrigger value="curl" className="flex-1">cURL</TabsTrigger>
                    </TabsList>
                    <TabsContent value="pino" className="bg-muted/50 rounded-lg p-4 mt-2 min-h-[280px]">
                      <CodeBlock
                        language="javascript"
                        code={`import pino from "pino";

const logger = pino({
  transport: {
    target: "@abbacchio/transport/pino",
    options: {
      url: "${window.location.origin}/api/logs",
      channel: "${urlChannel || 'my-app'}",${secretKey ? `
      secretKey: "${secretKey}",` : ''}
    },
  },
});

logger.info("Hello from Pino!");`}
                      />
                    </TabsContent>
                    <TabsContent value="winston" className="bg-muted/50 rounded-lg p-4 mt-2 min-h-[280px]">
                      <CodeBlock
                        language="javascript"
                        code={`import winston from "winston";
import { winstonTransport } from "@abbacchio/transport/winston";

const logger = winston.createLogger({
  transports: [
    winstonTransport({
      url: "${window.location.origin}/api/logs",
      channel: "${urlChannel || 'my-app'}",${secretKey ? `
      secretKey: "${secretKey}",` : ''}
    }),
  ],
});

logger.info("Hello from Winston!");`}
                      />
                    </TabsContent>
                    <TabsContent value="curl" className="bg-muted/50 rounded-lg p-4 mt-2 min-h-[280px]">
                      <CodeBlock
                        language="bash"
                        code={`curl -X POST ${window.location.origin}/api/logs \\
  -H "Content-Type: application/json" \\
  -H "X-Channel: ${urlChannel || 'my-app'}" \\
  -d '{"level":30,"msg":"Hello from curl!"}'`}
                      />
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const log = filteredLogs[virtualItem.index];
                // Guard against stale virtualizer items during clear
                if (!log) return null;
                return (
                  <div
                    key={log.id}
                    data-index={virtualItem.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <LogRow
                      log={log}
                      showChannel={channels.length > 1 && !channelFilter}
                      searchQuery={searchQuery}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Scroll to bottom indicator */}
        {!autoScroll && logs.length > 0 && (
          <Button
            onClick={scrollToBottom}
            className="fixed bottom-4 right-4 rounded-full shadow-lg"
          >
            <ArrowDown className="w-4 h-4 mr-2" />
            New logs
          </Button>
        )}

        {/* Key Generator Dialog */}
        <Dialog open={showKeyDialog} onOpenChange={(open) => {
          setShowKeyDialog(open);
          if (!open) {
            setGeneratedKey('');
            setCopiedKey(false);
            setShowFullKey(false);
          }
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Encryption Key</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Use this key to encrypt logs sent to your channels.
              </p>

              {isGeneratingKey && !generatedKey ? (
                <div className="flex items-center justify-center py-4">
                  <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <Input
                      type="text"
                      value={showFullKey ? generatedKey : maskedKey}
                      readOnly
                      className="font-mono text-sm pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowFullKey(!showFullKey)}
                      className="absolute right-0 top-0 h-full px-3"
                    >
                      {showFullKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={copyKey}
                      disabled={!generatedKey}
                    >
                      <Copy className="w-4 h-4 mr-1.5" />
                      {copiedKey ? 'Copied!' : 'Copy Key'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={generateNewKey}
                      disabled={isGeneratingKey}
                    >
                      <RefreshCw className={`w-4 h-4 mr-1.5 ${isGeneratingKey ? 'animate-spin' : ''}`} />
                      Generate
                    </Button>
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowKeyDialog(false)}
                >
                  Close
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
