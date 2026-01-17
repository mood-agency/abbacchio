import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { useChannelManager } from '../hooks/useChannelManager';
import { useChannelLogStream, PAGE_SIZE_OPTIONS } from '../hooks/useChannelLogStream';
import { useFilterParams } from '../hooks/useFilterParams';
import { FilterBar } from './FilterBar';
import { LogRow } from './LogRow';
import { CommandPalette } from './CommandPalette';
import { LanguageSwitcher } from './LanguageSwitcher';
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
import { SecretKeyInput, isValidKey } from '@/components/ui/secret-key-input';
import {
  Sun,
  Moon,
  RefreshCw,
  Copy,
  AlertTriangle,
  FileText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plug,
} from 'lucide-react';

export function LogViewer() {
  const { t } = useTranslation();
  const { t: tLogs } = useTranslation('logs');
  const { t: tDialogs } = useTranslation('dialogs');
  const { t: tFilters } = useTranslation('filters');

  // URL params for filters
  const {
    level: levelFilter,
    namespace: namespaceFilter,
    search: searchQuery,
    caseSensitive,
    setLevel: setLevelFilter,
    setNamespace: setNamespaceFilter,
    setSearch: setSearchQuery,
    setCaseSensitive,
    clearFilters,
  } = useFilterParams();

  // Multi-channel management
  const {
    channels,
    activeChannelId,
    setActiveChannelId,
    addChannel,
    removeChannel,
    updateChannelKey,
    totalCount,
    clearChannelLogs,
    onNewLogs,
    onClear,
    persistLogs,
    setPersistLogs,
  } = useChannelManager();

  // Get active channel
  const activeChannel = channels.find((ch) => ch.id === activeChannelId);

  // Logs for active channel
  const {
    logs,
    filteredCount,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    availableNamespaces,
    levelCounts,
    newLogIds,
    isLoading,
  } = useChannelLogStream({
    channelName: activeChannel?.name || null,
    levelFilter,
    namespaceFilter,
    searchQuery,
    onNewLogs,
    onClear,
    channelId: activeChannelId,
  });

  // Theme state
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  // Key dialog state
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');

  // Page jump input
  const [pageInput, setPageInput] = useState('');

  // Delete confirmation dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Add channel dialog
  const [showAddChannelDialog, setShowAddChannelDialog] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelKey, setNewChannelKey] = useState('');

  const generateNewKey = async () => {
    setIsGeneratingKey(true);
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
    setKeyInput(activeChannel?.secretKey || '');
  };

  // Apply the entered key for decryption
  const applyKey = () => {
    if (keyInput.trim() && activeChannelId) {
      if (!isValidKey(keyInput.trim())) {
        toast.error(tLogs('toast.invalidKeyFormat'), {
          description: tLogs('toast.invalidKeyDescription'),
        });
        return;
      }
      updateChannelKey(activeChannelId, keyInput.trim());
      setShowKeyDialog(false);
      toast.success(tLogs('toast.keyUpdated'));
    }
  };

  // Clear the current decryption key
  const clearKey = () => {
    if (activeChannelId) {
      updateChannelKey(activeChannelId, '');
    }
    setKeyInput('');
  };

  // Add new channel
  const handleAddChannel = () => {
    if (!newChannelName.trim()) {
      toast.error(tLogs('toast.channelNameRequired'), {
        description: tLogs('toast.channelNameRequiredDescription'),
      });
      return;
    }
    if (newChannelKey.trim() && !isValidKey(newChannelKey.trim())) {
      toast.error(tLogs('toast.invalidKeyFormat'), {
        description: tLogs('toast.invalidKeyDescription'),
      });
      return;
    }
    addChannel(newChannelName.trim(), newChannelKey.trim());
    setShowAddChannelDialog(false);
    setNewChannelName('');
    setNewChannelKey('');
    toast.success(tLogs('toast.connected', { channel: newChannelName.trim() }));
  };

  // Scroll container ref
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtTopRef = useRef(true);

  // Search input ref for Ctrl+F focus
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Handle Ctrl+F to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Track if user is at top of scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
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
    const regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');

    let count = 0;
    for (const log of logs) {
      const msgMatches = log.msg.match(regex);
      const dataMatches = JSON.stringify(log.data).match(regex);
      count += (msgMatches?.length || 0) + (dataMatches?.length || 0);
    }
    return count;
  }, [logs, searchQuery, caseSensitive]);

  // Virtualization for performance with large log lists
  const rowVirtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 36,
    overscan: 20,
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
    if (!activeChannelId) return;
    setIsDeleting(true);
    try {
      await clearChannelLogs(activeChannelId);
      setShowDeleteDialog(false);
      toast.success(tLogs('toast.logsDeleted'));
    } catch (error) {
      toast.error(tLogs('toast.deleteError'), {
        description: error instanceof Error ? error.message : 'An unknown error occurred',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [activeChannelId, clearChannelLogs]);

  // Calculate showing range
  const showingStart = filteredCount > 0 ? (currentPage - 1) * pageSize + 1 : 0;
  const showingEnd = Math.min(currentPage * pageSize, filteredCount);

  // Show welcome screen if no channels
  if (channels.length === 0) {
    return (
      <TooltipProvider>
        <div className="flex flex-col items-center justify-center h-screen bg-background">
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-6">🔌</div>
            <h1 className="text-2xl font-bold text-foreground mb-4">
              {tLogs('empty.welcome.title')}
            </h1>
            <p className="text-muted-foreground mb-6">
              {tLogs('empty.welcome.description')}
            </p>
            <Button onClick={() => setShowAddChannelDialog(true)} size="lg">
              <Plug className="w-5 h-5 mr-2" />
              {tLogs('addChannel')}
            </Button>
            <div className="mt-8 bg-muted rounded-lg p-4 text-left font-mono text-sm">
              <p className="text-muted-foreground mb-2">{tLogs('empty.welcome.urlHint')}</p>
              <span className="text-foreground">
                {window.location.origin}/?channel=<span className="text-green-500">my-channel-4827</span>&key=<span className="text-yellow-500">K7xQ2mN9pR4sT6vW8yZ0aB3cD5eF7gH9jL2nP4qS6tU</span>
              </span>
            </div>
          </div>

          {/* Add Channel Dialog */}
          <Dialog open={showAddChannelDialog} onOpenChange={setShowAddChannelDialog}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{tDialogs('addChannel.title')}</DialogTitle>
                <DialogDescription>
                  {tDialogs('addChannel.description')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{tDialogs('addChannel.channelName')}</label>
                  <Input
                    type="text"
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddChannel()}
                    placeholder={tDialogs('addChannel.channelPlaceholder')}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {tDialogs('addChannel.encryptionKey')} <span className="text-muted-foreground font-normal">{t('labels.optional')}</span>
                  </label>
                  <SecretKeyInput
                    value={newChannelKey}
                    onChange={setNewChannelKey}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddChannel()}
                    placeholder={tDialogs('addChannel.keyPlaceholder')}
                  />
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" onClick={() => setShowAddChannelDialog(false)}>
                  {t('actions.cancel')}
                </Button>
                <Button onClick={handleAddChannel}>
                  {t('actions.connect')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-background relative z-20">
          <h1 className="text-lg font-semibold text-foreground">{t('appName')}</h1>

          <div className="flex items-center gap-2">
            {/* Language switcher */}
            <LanguageSwitcher />
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
              <TooltipContent>{t('theme.toggleDarkMode')}</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* Channel Tabs */}
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/30 overflow-x-auto">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className={`group flex items-center gap-1.5 px-3 py-1 rounded-md text-sm cursor-pointer transition-colors ${
                channel.id === activeChannelId
                  ? 'bg-background shadow-sm border border-border'
                  : 'hover:bg-muted'
              }`}
              onClick={() => setActiveChannelId(channel.id)}
            >
              <span className="truncate max-w-[120px]">{channel.name}</span>
            </div>
          ))}
          {/* Add tab button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted text-muted-foreground"
                onClick={() => {
                  setNewChannelName('');
                  setNewChannelKey('');
                  setShowAddChannelDialog(true);
                }}
              >
                <Plug className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{tFilters('tooltips.addChannel')}</TooltipContent>
          </Tooltip>
        </div>

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Filter bar with level tabs */}
          <FilterBar
            ref={searchInputRef}
            namespaceFilter={namespaceFilter}
            setNamespaceFilter={setNamespaceFilter}
            availableNamespaces={availableNamespaces}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            matchCount={matchCount}
            caseSensitive={caseSensitive}
            setCaseSensitive={setCaseSensitive}
            onClearFilters={clearFilters}
            levelFilter={levelFilter}
            setLevelFilter={setLevelFilter}
            levelCounts={levelCounts}
            onCopyLink={() => {
              if (!activeChannel) return;
              const params = new URLSearchParams();
              params.set('channel', activeChannel.name);
              if (activeChannel.secretKey) params.set('key', activeChannel.secretKey);
              const link = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
              navigator.clipboard.writeText(link);
              toast.success(tLogs('toast.linkCopied'));
            }}
            persistLogs={persistLogs}
            onTogglePersist={() => {
              const newValue = !persistLogs;
              setPersistLogs(newValue);
              toast(newValue ? tLogs('persistence.enabled') : tLogs('persistence.disabled'), {
                description: newValue
                  ? tLogs('persistence.enabledDescription')
                  : tLogs('persistence.disabledDescription'),
              });
            }}
            onClearLogs={() => setShowDeleteDialog(true)}
            onDisconnect={() => {
              if (activeChannelId) {
                const channelName = activeChannel?.name;
                removeChannel(activeChannelId);
                toast(tLogs('toast.disconnected', { channel: channelName }));
              }
            }}
            onManageKey={openKeyDialog}
            hasSecretKey={!!activeChannel?.secretKey}
            hasEncryptedLogs={!!activeChannel?.hasEncryptedLogs}
          />

          {/* Column headers */}
          <div className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-muted-foreground tracking-wider border-b border-border bg-muted relative z-10">
            <span className="w-36 flex-shrink-0">Date/Time</span>
            <span className="w-5 flex-shrink-0"></span>
            <span className="w-16 flex-shrink-0">Level</span>
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
                {isLoading ? (
                  <>
                    <Loader2 className="w-16 h-16 mb-4 opacity-50 animate-spin" />
                    <p className="text-lg">{tLogs('empty.loading')}</p>
                  </>
                ) : activeChannel && !activeChannel.isConnected && !activeChannel.isConnecting ? (
                  <>
                    <AlertTriangle className="w-16 h-16 mb-4 text-destructive opacity-70" />
                    <p className="text-lg text-destructive">{tLogs('empty.connectionFailed.title')}</p>
                    <p className="text-sm mt-1">{activeChannel.connectionError || tLogs('empty.connectionFailed.defaultError')}</p>
                    <p className="text-xs mt-2 text-muted-foreground">{tLogs('empty.connectionFailed.hint')}</p>
                  </>
                ) : activeChannel?.isConnecting ? (
                  <>
                    <Loader2 className="w-16 h-16 mb-4 opacity-50 animate-spin" />
                    <p className="text-lg">{tLogs('empty.connecting', { channel: activeChannel.name })}</p>
                  </>
                ) : totalCount > 0 && (searchQuery || levelFilter !== 'all' || namespaceFilter) ? (
                  <>
                    <FileText className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg font-medium">{tLogs('empty.noMatches.title')}</p>
                    <p className="text-sm mt-1 text-muted-foreground">
                      {tLogs('empty.noMatches.description')}
                    </p>
                  </>
                ) : (
                  <div className="text-center w-[625px] px-6 py-8">
                    <FileText className="w-16 h-16 mb-4 opacity-50 mx-auto" />
                    <p className="text-lg font-medium">{tLogs('empty.noLogs.title')}</p>
                    <p className="text-sm mt-1 mb-6">{tLogs('empty.noLogs.description')}</p>

                    <div className="text-left mb-4 bg-muted/50 rounded-lg p-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{tLogs('install')}</p>
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
      channel: "${activeChannel?.name || 'my-app'}",${activeChannel?.secretKey ? `
      secretKey: "${activeChannel.secretKey}",` : ''}
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
      channel: "${activeChannel?.name || 'my-app'}",${activeChannel?.secretKey ? `
      secretKey: "${activeChannel.secretKey}",` : ''}
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
  -H "X-Channel: ${activeChannel?.name || 'my-app'}" \\
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
                        showChannel={false}
                        searchQuery={searchQuery}
                        caseSensitive={caseSensitive}
                        isNew={newLogIds.has(log.id)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Pagination controls */}
        {filteredCount > 0 && (
          <div className="flex items-center justify-center px-4 py-2 border-t border-border bg-muted/50">
            <div className="flex items-center gap-4">
              {/* Showing info */}
              <span className="text-sm text-muted-foreground">
                {tLogs('pagination.showing', { start: showingStart, end: showingEnd, total: filteredCount })}
              </span>

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
                <TooltipContent>{tLogs('pagination.firstPage')}</TooltipContent>
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
                <TooltipContent>{tLogs('pagination.previousPage')}</TooltipContent>
              </Tooltip>

              {/* Page info */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{tLogs('pagination.page')}</span>
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
                <span className="text-sm text-muted-foreground">{tLogs('pagination.of')} {totalPages}</span>
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
                <TooltipContent>{tLogs('pagination.nextPage')}</TooltipContent>
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
                <TooltipContent>{tLogs('pagination.lastPage')}</TooltipContent>
              </Tooltip>

              {/* Page size selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{tLogs('pagination.perPage')}</span>
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
          </div>
        )}

        {/* Key Dialog */}
        <Dialog open={showKeyDialog} onOpenChange={(open) => {
          setShowKeyDialog(open);
          if (!open) {
            setGeneratedKey('');
            setCopiedKey(false);
          }
        }}>
          <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>{tDialogs('encryptionKey.title')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              {/* Decryption Key Section */}
              <div className="space-y-3">
                <p className="text-sm font-medium">{tDialogs('encryptionKey.decryption.title')}</p>
                <p className="text-sm text-muted-foreground">
                  {tDialogs('encryptionKey.decryption.description')}
                </p>
                <SecretKeyInput
                  value={keyInput}
                  onChange={setKeyInput}
                  onKeyDown={(e) => e.key === 'Enter' && applyKey()}
                  placeholder={tDialogs('encryptionKey.decryption.placeholder')}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={applyKey}
                    disabled={!keyInput.trim()}
                  >
                    {tDialogs('encryptionKey.decryption.apply')}
                  </Button>
                  {activeChannel?.secretKey && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={clearKey}
                    >
                      {tDialogs('encryptionKey.decryption.clear')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="border-t" />

              {/* Key Generator Utility Section */}
              <div className="space-y-3">
                <p className="text-sm font-medium">{tDialogs('encryptionKey.generator.title')}</p>
                <p className="text-sm text-muted-foreground">
                  {tDialogs('encryptionKey.generator.description')}
                </p>
                {isGeneratingKey && !generatedKey ? (
                  <div className="flex items-center justify-center py-4">
                    <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : generatedKey ? (
                  <div className="space-y-3">
                    <SecretKeyInput
                      value={generatedKey}
                      readOnly
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={copyKey}
                      >
                        <Copy className="w-4 h-4 mr-1.5" />
                        {copiedKey ? tDialogs('encryptionKey.generator.copied') : tDialogs('encryptionKey.generator.copyKey')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={generateNewKey}
                        disabled={isGeneratingKey}
                      >
                        <RefreshCw className={`w-4 h-4 mr-1.5 ${isGeneratingKey ? 'animate-spin' : ''}`} />
                        {tDialogs('encryptionKey.generator.regenerate')}
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
                    {tDialogs('encryptionKey.generator.generate')}
                  </Button>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowKeyDialog(false)}
                >
                  {t('actions.close')}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{tDialogs('deleteConfirmation.title', { channel: activeChannel?.name })}</DialogTitle>
              <DialogDescription>
                {tDialogs('deleteConfirmation.description')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
              >
                {t('actions.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? tDialogs('deleteConfirmation.deleting') : tDialogs('deleteConfirmation.deleteAll')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Channel Dialog */}
        <Dialog open={showAddChannelDialog} onOpenChange={setShowAddChannelDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{tDialogs('addChannel.title')}</DialogTitle>
              <DialogDescription>
                {tDialogs('addChannel.description')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{tDialogs('addChannel.channelName')}</label>
                <Input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddChannel()}
                  placeholder={tDialogs('addChannel.channelPlaceholder')}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {tDialogs('addChannel.encryptionKey')} <span className="text-muted-foreground font-normal">{t('labels.optional')}</span>
                </label>
                <SecretKeyInput
                  value={newChannelKey}
                  onChange={setNewChannelKey}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddChannel()}
                  placeholder={tDialogs('addChannel.keyPlaceholder')}
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setShowAddChannelDialog(false)}>
                {t('actions.cancel')}
              </Button>
              <Button onClick={handleAddChannel}>
                {t('actions.connect')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Command Palette for switching channels */}
        <CommandPalette
          channels={channels}
          activeChannelId={activeChannelId}
          onSelectChannel={setActiveChannelId}
        />
      </div>
    </TooltipProvider>
  );
}
