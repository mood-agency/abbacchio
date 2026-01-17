import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { useLogStream, PAGE_SIZE_OPTIONS } from '../hooks/useLogStream';
import { FilterBar } from './FilterBar';
import { LogRow } from './LogRow';
import { LevelBadge } from '@/components/ui/CustomBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  RefreshCw,
  Copy,
  Eye,
  EyeOff,
  Check,
  AlertTriangle,
  FileText,
  Loader2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  DatabaseBackup,
  Radio,
} from 'lucide-react';

export function LogViewer() {
  const {
    logs,
    filteredCount,
    totalCount,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    levelFilter,
    setLevelFilter,
    namespaceFilter,
    setNamespaceFilter,
    searchQuery,
    setSearchQuery,
    isConnected,
    isConnecting,
    clearLogs,
    connectionError,
    secretKey,
    setSecretKey,
    hasEncryptedLogs,
    channels,
    urlChannel,
    availableNamespaces,
    persistLogs,
    setPersistLogs,
    levelCounts,
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

  // Key dialog state
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showFullKey, setShowFullKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');

  // Page jump input
  const [pageInput, setPageInput] = useState('');

  // Search case sensitivity
  const [caseSensitive, setCaseSensitive] = useState(false);

  // Delete confirmation dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Channel switch dialog
  const [showChannelDialog, setShowChannelDialog] = useState(false);
  const [newChannel, setNewChannel] = useState('');
  const [newKey, setNewKey] = useState('');

  // Navigate to new channel
  const goToChannel = () => {
    if (!newChannel.trim()) return;
    const params = new URLSearchParams();
    params.set('channel', newChannel.trim());
    if (newKey.trim()) {
      params.set('key', newKey.trim());
    }
    window.location.href = `${window.location.pathname}?${params.toString()}`;
  };

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

  // Open key dialog
  const openKeyDialog = () => {
    setShowKeyDialog(true);
    setCopiedKey(false);
    setKeyInput(secretKey); // Pre-fill with current key if exists
  };

  // Apply the entered key for decryption
  const applyKey = () => {
    if (keyInput.trim()) {
      setSecretKey(keyInput.trim());
      setShowKeyDialog(false);
    }
  };

  // Clear the current decryption key
  const clearKey = () => {
    setSecretKey('');
    setKeyInput('');
  };

  // Copy full link with channel and key
  const [copiedLink, setCopiedLink] = useState(false);
  const channelFilter = urlChannel;
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

  // Scroll container ref
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtTopRef = useRef(true);

  // Track if user is at top of scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Consider "at top" if within 50px of the top
      isAtTopRef.current = container.scrollTop < 50;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll to top when page changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
      isAtTopRef.current = true;
    }
  }, [currentPage]);

  // Count total search matches across current page logs
  const matchCount = useMemo(() => {
    if (!searchQuery) return 0;
    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');

    let count = 0;
    for (const log of logs) {
      const msgMatches = log.msg.match(regex);
      const dataMatches = JSON.stringify(log.data).match(regex);
      count += (msgMatches?.length || 0) + (dataMatches?.length || 0);
    }
    return count;
  }, [logs, searchQuery]);

  // Virtualization for performance with large log lists
  const rowVirtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 36, // Estimated row height in pixels
    overscan: 20, // Render extra rows outside viewport for smoother scrolling
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  // Handle page jump
  const handlePageJump = useCallback(() => {
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      setPageInput('');
    }
  }, [pageInput, totalPages, setCurrentPage]);

  // Handle delete confirmation
  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await clearLogs();
      setShowDeleteDialog(false);
      toast.success('All logs have been deleted');
    } catch (error) {
      toast.error('Failed to delete logs', {
        description: error instanceof Error ? error.message : 'An unknown error occurred',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [clearLogs]);

  // Calculate showing range
  const showingStart = filteredCount > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const showingEnd = Math.min(currentPage * pageSize, filteredCount);

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-background relative z-20">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
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
              {secretKey && (
                <div className="flex items-center gap-1 ml-5 text-xs text-muted-foreground">
                  <Key className="w-3 h-3" />
                  <span className="font-mono">
                    {secretKey.slice(0, 4)}{'*'.repeat(Math.max(0, secretKey.length - 4))}
                  </span>
                </div>
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
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear all logs</TooltipContent>
            </Tooltip>

            {/* Persist logs toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const newValue = !persistLogs;
                    setPersistLogs(newValue);
                    toast(newValue ? 'Log persistence enabled' : 'Log persistence disabled', {
                      description: newValue
                        ? 'Logs will be saved to SQLite storage'
                        : 'Logs will only be kept in memory',
                    });
                  }}
                  className={persistLogs ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}
                >
                  {persistLogs ? <DatabaseBackup className="w-5 h-5" /> : <Database className="w-5 h-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{persistLogs ? 'Disable log persistence' : 'Enable log persistence'}</TooltipContent>
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

            {/* Switch channel button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setNewChannel('');
                    setNewKey('');
                    setShowChannelDialog(true);
                  }}
                >
                  <Radio className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Switch channel</TooltipContent>
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

        {/* Main content with sidebar */}
        <div className="flex flex-1 overflow-hidden">
          {/* Level sidebar */}
          <aside className="w-44 border-r border-border bg-muted/30 flex flex-col">
            <div className="p-3 text-xs font-medium text-muted-foreground">
              Log Levels
            </div>
            <nav className="flex-1 px-2 pb-2 space-y-1">
              {(['all', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).map((level) => {
                const count = levelCounts[level];
                const isActive = levelFilter === level;
                return (
                  <button
                    key={level}
                    onClick={() => setLevelFilter(level)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 text-sm rounded-md transition-colors ${
                      isActive
                        ? 'bg-primary/10 ring-1 ring-primary/30'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {level === 'all' ? (
                      <span className={`text-xs font-medium px-2 py-0.5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                        ALL
                      </span>
                    ) : (
                      <LevelBadge level={level} />
                    )}
                    <span className={`text-xs tabular-nums ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                      {count.toLocaleString()}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Main log area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Filter bar */}
            <FilterBar
              namespaceFilter={namespaceFilter}
              setNamespaceFilter={setNamespaceFilter}
              availableNamespaces={availableNamespaces}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              matchCount={matchCount}
              caseSensitive={caseSensitive}
              setCaseSensitive={setCaseSensitive}
            />

            {/* Column headers */}
            <div className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted relative z-10">
              <span className="w-24 flex-shrink-0">Time</span>
              <span className="w-5 flex-shrink-0"></span>
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
            >
          {logs.length === 0 ? (
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
              ) : totalCount > 0 && (searchQuery || levelFilter !== 'all' || namespaceFilter) ? (
                <>
                  <FileText className="w-16 h-16 mb-4 opacity-50" />
                  <p className="text-lg font-medium">No matching logs</p>
                  <p className="text-sm mt-1 text-muted-foreground">
                    Try adjusting your search or filters
                  </p>
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
                const log = logs[virtualItem.index];
                // Guard against stale virtualizer items during clear
                if (!log) return null;
                return (
                  <div
                    key={`${log.id}-${searchQuery}`}
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
                      caseSensitive={caseSensitive}
                    />
                  </div>
                );
              })}
            </div>
          )}
            </ScrollArea>
          </div>
        </div>

        {/* Pagination controls */}
        {filteredCount > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/50">
            {/* Left: Showing info */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                Showing {showingStart}-{showingEnd} of {filteredCount}
              </span>

              {/* Page size selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Per page:</span>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => setPageSize(parseInt(value, 10) as typeof pageSize)}
                >
                  <SelectTrigger className="w-20 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={size.toString()}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Right: Pagination controls */}
            <div className="flex items-center gap-2">
              {/* First page */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>First page</TooltipContent>
              </Tooltip>

              {/* Previous page */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Previous page</TooltipContent>
              </Tooltip>

              {/* Page info */}
              <div className="flex items-center gap-2 px-2">
                <span className="text-sm text-muted-foreground">Page</span>
                <Input
                  type="text"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handlePageJump();
                    }
                  }}
                  onBlur={handlePageJump}
                  placeholder={currentPage.toString()}
                  className="w-12 h-8 text-center px-1"
                />
                <span className="text-sm text-muted-foreground">of {totalPages}</span>
              </div>

              {/* Next page */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Next page</TooltipContent>
              </Tooltip>

              {/* Last page */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Last page</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}

        {/* Key Dialog */}
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
            <div className="space-y-6">
              {/* Decryption Key Section */}
              <div className="space-y-3">
                <p className="text-sm font-medium">Decryption Key</p>
                <p className="text-sm text-muted-foreground">
                  Enter your key to decrypt encrypted logs.
                </p>
                <div className="relative">
                  <Input
                    type={showFullKey ? 'text' : 'password'}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && applyKey()}
                    placeholder="Paste your encryption key..."
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
                    size="sm"
                    onClick={applyKey}
                    disabled={!keyInput.trim()}
                  >
                    Apply Key
                  </Button>
                  {secretKey && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={clearKey}
                    >
                      Clear Key
                    </Button>
                  )}
                </div>
              </div>

              <div className="border-t" />

              {/* Key Generator Utility Section */}
              <div className="space-y-3">
                <p className="text-sm font-medium">Key Generator</p>
                <p className="text-sm text-muted-foreground">
                  Generate a new key to use in your transport configuration.
                </p>
                {isGeneratingKey && !generatedKey ? (
                  <div className="flex items-center justify-center py-4">
                    <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : generatedKey ? (
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
                        Regenerate
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={generateNewKey}
                    disabled={isGeneratingKey}
                  >
                    <RefreshCw className="w-4 h-4 mr-1.5" />
                    Generate Key
                  </Button>
                )}
              </div>

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

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete all logs?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. All logs will be permanently deleted from your browser storage and the server.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete all'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Switch Channel Dialog */}
        <Dialog open={showChannelDialog} onOpenChange={setShowChannelDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Switch Channel</DialogTitle>
              <DialogDescription>
                Enter a channel name and optionally an encryption key to view logs from another channel.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Channel</label>
                <Input
                  type="text"
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && goToChannel()}
                  placeholder="e.g., my-app"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Encryption Key <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Input
                  type="password"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && goToChannel()}
                  placeholder="Enter key if logs are encrypted"
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowChannelDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={goToChannel}
                disabled={!newChannel.trim()}
              >
                Go to Channel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
