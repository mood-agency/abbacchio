import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { useChannelManager } from '../hooks/useChannelManager';
import { useChannelLogStream } from '../hooks/useChannelLogStream';
import { useTimelineNavigation } from '../hooks/useTimelineNavigation';
import { useSavedFilters } from '../hooks/useSavedFilters';
import type { LogEntry } from '../types';
import { TIME_RANGE_OPTIONS } from '../types';
import { useFilterParams } from '../hooks/useFilterParams';
import { TimelineScrollbar } from './TimelineScrollbar';
import { FilterBar } from './FilterBar';
import { LogSidebar } from './LogSidebar';
import { SaveFilterDialog } from './SaveFilterDialog';
import { ExportDialog } from './ExportDialog';
import { LogRow } from './LogRow';
import { LevelBadge } from './ui/CustomBadge';
import { CommandPalette } from './CommandPalette';
import { LanguageSwitcher } from './LanguageSwitcher';
import { OnboardingWizard } from './OnboardingWizard';
import { useSecureStorage } from '@/contexts/SecureStorageContext';
import { saveSecureChannels, type SecureChannelConfig } from '@/lib/secure-storage';
import { formatLogsForClipboard, downloadLogs, type ExportFormat } from '@/lib/format-logs';
import { getDatabaseStats } from '@/lib/sqlite-db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { DropdownMenuTrigger } from '@radix-ui/react-dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeBlock } from '@/components/ui/code-block';
import { InteractiveJsonView } from '@/components/ui/interactive-json-view';
import { SecretKeyInput, isValidKey } from '@/components/ui/secret-key-input';
import {
  Sun,
  Moon,
  RefreshCw,
  AlertTriangle,
  FileText,
  Loader2,
  ChevronDown,
  Radio,
  LockOpen,
  Check,
  Minus,
  Save,
  SaveOff,
  MoreVertical,
  Key,
  Link,
  Trash2,
  Unplug,
  Settings,
  SearchX,
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  Download,
} from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export function LogViewer() {
  const { t, i18n } = useTranslation();
  const { t: tLogs } = useTranslation('logs');
  const { t: tDialogs } = useTranslation('dialogs');
  const { t: tFilters } = useTranslation('filters');

  // Secure storage for master password
  const { isReady, setMasterPassword, setReady, setInitialChannels, hasExistingStorage, isPasswordInSession, clearFromSession } = useSecureStorage();

  // URL params for filters
  const {
    levels: levelFilters,
    namespaces: namespaceFilters,
    timeRange,
    search: searchQuery,
    caseSensitive,
    useRegex,
    setLevels,
    toggleLevel,
    setNamespaces,
    toggleNamespace,
    setTimeRange,
    setSearch: setSearchQuery,
    setCaseSensitive,
    setUseRegex,
    setAllFilters,
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
    clearChannelLogs,
    onNewLogs,
    onClear,
    persistLogs,
    setPersistLogs,
    isPaused,
    setIsPaused,
  } = useChannelManager();

  // Get active channel
  const activeChannel = channels.find((ch) => ch.id === activeChannelId);

  // Logs for active channel
  const {
    logs,
    filteredCount,
    availableNamespaces,
    levelCounts,
    namespaceCounts,
    newLogIds,
    isLoading,
    hourlyData,
    logTimeRange,
  } = useChannelLogStream({
    channelName: activeChannel?.name || null,
    levelFilters,
    namespaceFilters,
    timeRange,
    searchQuery,
    useRegex,
    caseSensitive,
    onNewLogs,
    onClear,
    channelId: activeChannelId,
  });

  // Theme state
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  // Key dialog state
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');

  // Delete confirmation dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Add channel dialog
  const [showAddChannelDialog, setShowAddChannelDialog] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelKey, setNewChannelKey] = useState('');

  // Save filter dialog
  const [showSaveFilterDialog, setShowSaveFilterDialog] = useState(false);

  // Export dialog state
  const [showExportDialog, setShowExportDialog] = useState(false);

  // Saved filters hook
  const { savedFilters, saveFilter, deleteFilter } = useSavedFilters(activeChannelId);

  // Row selection state for copy - using Set of log IDs for stable selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Track last selected log ID for shift+click range selection
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // Data drawer state
  const [drawerLog, setDrawerLog] = useState<LogEntry | null>(null);

  // Sidebar visibility state
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Check if any filters are active (to distinguish "no logs" from "no matching logs")
  const hasActiveFilters = useMemo(() => {
    return (
      searchQuery.length > 0 ||
      levelFilters.length > 0 ||
      namespaceFilters.length > 0 ||
      timeRange !== 'all'
    );
  }, [searchQuery, levelFilters, namespaceFilters, timeRange]);

  // Validate regex and get error message if invalid
  const regexError = useMemo(() => {
    if (!useRegex || !searchQuery) return null;
    try {
      new RegExp(searchQuery);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid regex';
    }
  }, [useRegex, searchQuery]);

  // Handle row selection (click to toggle, shift+click for range)
  const handleRowSelect = useCallback((logId: string, shiftKey: boolean) => {
    if (shiftKey && lastSelectedId !== null) {
      // Shift+click: select range from last selected to current
      const lastIndex = logs.findIndex(log => log.id === lastSelectedId);
      const currentIndex = logs.findIndex(log => log.id === logId);
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const newSelection = new Set(selectedIds);
        for (let i = start; i <= end; i++) {
          newSelection.add(logs[i].id);
        }
        setSelectedIds(newSelection);
      }
    } else {
      // Regular click: toggle selection
      const newSelection = new Set(selectedIds);
      if (newSelection.has(logId)) {
        newSelection.delete(logId);
      } else {
        newSelection.add(logId);
      }
      setSelectedIds(newSelection);
      setLastSelectedId(newSelection.has(logId) ? logId : null);
    }
  }, [selectedIds, lastSelectedId, logs]);

  // Handle select all / deselect all
  const handleSelectAll = useCallback(() => {
    if (logs.length === 0) return;

    if (selectedIds.size > 0) {
      // Deselect all if any are selected
      setSelectedIds(new Set());
      setLastSelectedId(null);
    } else {
      // Select all if none are selected
      const allIds = new Set<string>(logs.map(log => log.id));
      setSelectedIds(allIds);
      setLastSelectedId(logs[logs.length - 1]?.id ?? null);
    }
  }, [logs, selectedIds.size]);

  // Determine checkbox state: all selected, some selected, or none
  const selectAllState = useMemo(() => {
    if (logs.length === 0 || selectedIds.size === 0) return 'none';
    if (selectedIds.size === logs.length) return 'all';
    return 'some';
  }, [logs.length, selectedIds.size]);

  // Copy selected logs to clipboard
  const copySelectedLogs = useCallback(async () => {
    if (selectedIds.size === 0) return;

    const selectedLogs = logs.filter(log => selectedIds.has(log.id));
    const formatted = formatLogsForClipboard(selectedLogs);

    try {
      await navigator.clipboard.writeText(formatted);
      toast.success(tLogs('toast.logsCopied', { count: selectedLogs.length }));
    } catch (err) {
      console.error('Failed to copy logs:', err);
      toast.error(tLogs('toast.copyFailed'));
    }
  }, [selectedIds, logs, tLogs]);

  // Keyboard shortcut: Ctrl+C to copy selected, Escape to clear selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedIds.size > 0) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
          e.preventDefault();
          copySelectedLogs();
        } else if (e.key === 'Escape') {
          setSelectedIds(new Set());
          setLastSelectedId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, copySelectedLogs]);

  // Clear selection when filters change
  useEffect(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, [levelFilters, namespaceFilters, searchQuery, timeRange]);

  // Open key dialog
  const openKeyDialog = () => {
    setShowKeyDialog(true);
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

  // Count total search matches across current page logs (via SQLite)
  const [matchCount, setMatchCount] = useState(0);
  useEffect(() => {
    if (!searchQuery || logs.length === 0) {
      setMatchCount(0);
      return;
    }

    // Debounce the SQLite query to avoid excessive calls while typing
    const timeoutId = setTimeout(async () => {
      try {
        const { getSearchMatchCount } = await import('@/lib/sqlite-db');
        const count = await getSearchMatchCount({
          search: searchQuery,
          logIds: logs.map((log) => log.id),
        });
        setMatchCount(count);
      } catch (error) {
        console.error('Failed to get search match count:', error);
        setMatchCount(0);
      }
    }, 150); // 150ms debounce

    return () => clearTimeout(timeoutId);
  }, [logs, searchQuery]);

  // Virtualization for performance with large log lists
  const rowVirtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 36,
    overscan: 20,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  // Timeline navigation
  const currentMinTime = TIME_RANGE_OPTIONS[timeRange] === 0
    ? undefined
    : Date.now() - TIME_RANGE_OPTIONS[timeRange];

  const {
    thumbPosition,
    currentHour,
    scrollToHour,
    handleThumbDrag,
    isDragging,
    setIsDragging,
    setHourPositions,
    isNavigating,
  } = useTimelineNavigation({
    logs,
    hourlyData,
    logTimeRange,
    virtualizer: rowVirtualizer,
    scrollContainerRef,
    channelName: activeChannel?.name || null,
    filters: {
      levels: levelFilters,
      namespaces: namespaceFilters,
      minTime: currentMinTime,
      search: searchQuery,
    },
  });

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

  // Handle saving a filter
  const handleSaveFilter = useCallback((name: string) => {
    saveFilter(name, {
      levels: levelFilters,
      namespaces: namespaceFilters,
      timeRange,
      search: searchQuery,
      caseSensitive,
      useRegex,
    });
    toast.success(tFilters('savedFilters.toast.saved'));
  }, [saveFilter, levelFilters, namespaceFilters, timeRange, searchQuery, caseSensitive, useRegex, tFilters]);

  // Handle loading a saved filter
  const handleLoadFilter = useCallback((filter: typeof savedFilters[0]) => {
    setAllFilters({
      levels: filter.levels,
      namespaces: filter.namespaces,
      timeRange: filter.timeRange,
      search: filter.search,
      caseSensitive: filter.caseSensitive,
      useRegex: filter.useRegex,
    });
  }, [setAllFilters]);

  // Handle deleting a saved filter
  const handleDeleteFilter = useCallback((filterId: string) => {
    deleteFilter(filterId);
    toast.success(tFilters('savedFilters.toast.deleted'));
  }, [deleteFilter, tFilters]);

  // Handle exporting logs
  const handleExport = useCallback((format: ExportFormat) => {
    if (logs.length === 0 || !activeChannel) {
      toast.error(tFilters('export.toast.noLogs'));
      return;
    }
    downloadLogs(logs, format, activeChannel.name);
    toast.success(tFilters('export.toast.success'));
  }, [logs, activeChannel, tFilters]);

  // If encrypted storage exists but not yet unlocked, show nothing
  // (the MasterPasswordDialog will be shown by App.tsx)
  if (!isReady && hasExistingStorage()) {
    return null;
  }

  // Show onboarding wizard only if no channels AND no existing encrypted storage
  // (new user who hasn't set up yet)
  if (channels.length === 0 && !hasExistingStorage()) {
    return (
      <OnboardingWizard
        onComplete={async (channelName, secretKey, masterPassword) => {
          // Save the initial channel with master password
          const channelConfig: SecureChannelConfig = {
            id: crypto.randomUUID(),
            name: channelName,
            secretKey: secretKey,
          };

          // Initialize secure storage with master password
          const result = await saveSecureChannels([channelConfig], masterPassword);

          if (result.success) {
            // Set the master password in context
            setMasterPassword(masterPassword);
            setInitialChannels([channelConfig]);
            setReady(true);

            // Add channel to the manager
            addChannel(channelName, secretKey);
            toast.success(tLogs('toast.connected', { channel: channelName }));
          } else {
            toast.error(tDialogs('masterPassword.encryptionFailed'));
          }
        }}
      />
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background relative z-20">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <span className="font-semibold text-foreground">{t('appName')}</span>
              </BreadcrumbItem>
              {channels.length > 0 && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-1.5 px-2 py-1 -mx-2 -my-1 rounded-md hover:bg-muted transition-colors">
                          <Radio className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>{activeChannel?.name}</span>
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {channels.map((channel) => (
                          <DropdownMenuItem
                            key={channel.id}
                            onClick={() => setActiveChannelId(channel.id)}
                            className={channel.id === activeChannelId ? 'bg-accent' : ''}
                          >
                            <span className="truncate max-w-[200px]">{channel.name}</span>
                            {channel.id === activeChannelId && (
                              <Check className="w-3.5 h-3.5 ml-auto" />
                            )}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            setNewChannelName('');
                            setNewChannelKey('');
                            setShowAddChannelDialog(true);
                          }}
                        >
                          {tFilters('tooltips.addChannel')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>

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
            {/* Settings menu (gear icon) */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Settings className="w-5 h-5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('settings.title')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                {/* Persistence toggle */}
                <DropdownMenuItem
                  onClick={() => {
                    const newValue = !persistLogs;
                    setPersistLogs(newValue);
                    toast(newValue ? tLogs('persistence.enabled') : tLogs('persistence.disabled'), {
                      description: newValue
                        ? tLogs('persistence.enabledDescription')
                        : tLogs('persistence.disabledDescription'),
                    });
                  }}
                >
                  {persistLogs ? <Save className="w-4 h-4 mr-2" /> : <SaveOff className="w-4 h-4 mr-2 text-yellow-600 dark:text-yellow-400" />}
                  {persistLogs ? tFilters('tooltips.disablePersistence') : tFilters('tooltips.enablePersistence')}
                </DropdownMenuItem>
                {/* Clear session password */}
                {isPasswordInSession && (
                  <DropdownMenuItem
                    onClick={() => {
                      clearFromSession();
                      toast.success(t('session.passwordCleared'));
                    }}
                  >
                    <LockOpen className="w-4 h-4 mr-2" />
                    {t('session.clearPassword')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Channel options menu (three dots) - only shown when channel is active */}
            {activeChannel && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreVertical className="w-5 h-5" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{tFilters('tooltips.channelOptions')}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end">
                  {/* Key manager */}
                  <DropdownMenuItem onClick={openKeyDialog}>
                    <Key className={`w-4 h-4 mr-2 ${
                      activeChannel.secretKey
                        ? 'text-green-600 dark:text-green-400'
                        : activeChannel.hasEncryptedLogs
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : ''
                    }`} />
                    {tFilters('tooltips.manageKey')}
                  </DropdownMenuItem>
                  {/* Export logs */}
                  <DropdownMenuItem
                    onClick={() => {
                      if (filteredCount === 0) {
                        toast.error(tFilters('export.toast.noLogs'));
                        return;
                      }
                      setShowExportDialog(true);
                    }}
                    disabled={filteredCount === 0}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    {tFilters('export.tooltip')}
                  </DropdownMenuItem>
                  {/* Copy link */}
                  <DropdownMenuItem
                    onClick={() => {
                      const params = new URLSearchParams();
                      params.set('channel', activeChannel.name);
                      if (activeChannel.secretKey) params.set('key', activeChannel.secretKey);
                      const link = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
                      navigator.clipboard.writeText(link);
                      toast.success(tLogs('toast.linkCopied'));
                    }}
                  >
                    <Link className="w-4 h-4 mr-2" />
                    {tFilters('tooltips.copyLink')}
                  </DropdownMenuItem>
                  {/* Clear logs */}
                  <DropdownMenuItem onClick={() => setShowDeleteDialog(true)}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    {tFilters('tooltips.clearLogs')}
                  </DropdownMenuItem>
                  {/* Disconnect */}
                  <DropdownMenuItem
                    onClick={() => {
                      const channelName = activeChannel.name;
                      removeChannel(activeChannelId!);
                      toast(tLogs('toast.disconnected', { channel: channelName }));
                    }}
                  >
                    <Unplug className="w-4 h-4 mr-2" />
                    {tFilters('tooltips.disconnect')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        {/* Main content with sidebar */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar with filters - shown when connected, has logs or active filters, and sidebar is open */}
          {activeChannel?.isConnected && (logs.length > 0 || hasActiveFilters) && isSidebarOpen && (
            <LogSidebar
              levelFilters={levelFilters}
              toggleLevel={toggleLevel}
              clearLevels={() => setLevels([])}
              levelCounts={levelCounts}
              namespaceFilters={namespaceFilters}
              toggleNamespace={toggleNamespace}
              clearNamespaces={() => setNamespaces([])}
              availableNamespaces={availableNamespaces}
              namespaceCounts={namespaceCounts}
              timeRange={timeRange}
              setTimeRange={setTimeRange}
            />
          )}

          {/* Log content area */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Show filter bar when there are logs or active filters */}
            {(logs.length > 0 || hasActiveFilters) && (
              <FilterBar
                ref={searchInputRef}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                matchCount={matchCount}
                caseSensitive={caseSensitive}
                setCaseSensitive={setCaseSensitive}
                useRegex={useRegex}
                setUseRegex={setUseRegex}
                regexError={regexError}
                onClearFilters={clearFilters}
                levelFilters={levelFilters}
                namespaceFilters={namespaceFilters}
                timeRange={timeRange}
                isPaused={isPaused}
                onTogglePause={() => setIsPaused(!isPaused)}
                selectedCount={selectedIds.size}
                onCopySelected={copySelectedLogs}
                onClearSelection={() => {
                  setSelectedIds(new Set());
                  setLastSelectedId(null);
                }}
                savedFilters={savedFilters}
                onSaveFilter={() => setShowSaveFilterDialog(true)}
                onLoadFilter={handleLoadFilter}
                onDeleteFilter={handleDeleteFilter}
              />
            )}

            {/* Show table when there are logs */}
            {logs.length > 0 ? (
              <>
                {/* Column headers */}
                <div className="flex items-center text-xs font-medium text-muted-foreground tracking-wider border-y border-border bg-background relative z-10">
                  {/* Select all checkbox */}
                  <div
                    className="w-10 flex-shrink-0 border-r border-border py-2 flex items-center justify-center cursor-pointer hover:bg-muted/50"
                    onClick={handleSelectAll}
                  >
                    <div className={`w-4 h-4 rounded border ${selectAllState !== 'none' ? 'bg-primary border-primary' : 'border-muted-foreground/50'} flex items-center justify-center transition-colors`}>
                      {selectAllState === 'all' && <Check className="w-3 h-3 text-primary-foreground" />}
                      {selectAllState === 'some' && <Minus className="w-3 h-3 text-primary-foreground" />}
                    </div>
                  </div>
                  {/* Header labels */}
                  <div className="flex-1 flex items-center gap-3 px-4 py-2">
                    <span className="w-36 flex-shrink-0">{tLogs('drawer.timestamp')}</span>
                    <span className="w-5 flex-shrink-0"></span>
                    <span className="w-16 flex-shrink-0">Level</span>
                    <span className="w-28 flex-shrink-0">Namespace</span>
                    <span className="w-48 flex-shrink-0">Message</span>
                    <span className="flex-1">Data</span>
                  </div>
                </div>

                {/* Log list with timeline */}
                <div className="flex flex-1 overflow-hidden">
                  <div className="flex-1 relative">
                    <ScrollArea
                      className="h-full"
                      viewPortRef={scrollContainerRef}
                    >
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
                                showChannel={false}
                                searchQuery={searchQuery}
                                caseSensitive={caseSensitive}
                                useRegex={useRegex}
                                isNew={newLogIds.has(log.id)}
                                isSelected={selectedIds.has(log.id)}
                                onSelect={handleRowSelect}
                                onDataClick={setDrawerLog}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>

                    {/* Navigation loading overlay */}
                    {isNavigating && (
                      <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10 pointer-events-none">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      </div>
                    )}
                  </div>

                  {/* Timeline scrollbar */}
                  {hourlyData.length > 0 && (
                    <TimelineScrollbar
                      hourlyData={hourlyData}
                      logTimeRange={logTimeRange}
                      thumbPosition={thumbPosition}
                      currentHour={currentHour}
                      onHourClick={scrollToHour}
                      onThumbDrag={handleThumbDrag}
                      isDragging={isDragging}
                      onDragStart={() => setIsDragging(true)}
                      onDragEnd={() => setIsDragging(false)}
                      onHourPositionsChange={setHourPositions}
                    />
                  )}
                </div>
              </>
            ) : (
              /* Empty state - no logs */
              <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
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
                ) : hasActiveFilters ? (
                  <>
                    <SearchX className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg font-medium">{tLogs('empty.noMatches.title')}</p>
                    <p className="text-sm mt-1">{tLogs('empty.noMatches.description')}</p>
                  </>
                ) : (
                  <div className="text-center w-[625px] px-6 py-8">
                    <FileText className="w-16 h-16 mb-4 opacity-50 mx-auto" />
                    <p className="text-lg font-medium">{tLogs('empty.noLogs.title')}</p>
                    <p className="text-sm mt-1 mb-6">{tLogs('empty.noLogs.description')}</p>

                    <Tabs defaultValue="nodejs" className="text-left">
                      <TabsList className="w-full">
                        <TabsTrigger value="nodejs" className="flex-1">Node.js</TabsTrigger>
                        <TabsTrigger value="python" className="flex-1">Python</TabsTrigger>
                        <TabsTrigger value="http" className="flex-1">HTTP</TabsTrigger>
                      </TabsList>
                      <TabsContent value="nodejs" className="mt-2">
                        <div className="bg-muted/50 rounded-lg p-4 mb-3">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{tLogs('install')}</p>
                          <CodeBlock code="npm install @abbacchio/transport" language="bash" />
                        </div>
                        <Tabs defaultValue="pino">
                          <TabsList className="w-full">
                            <TabsTrigger value="pino" className="flex-1">Pino</TabsTrigger>
                            <TabsTrigger value="winston" className="flex-1">Winston</TabsTrigger>
                          </TabsList>
                          <TabsContent value="pino" className="bg-muted/50 rounded-lg p-4 mt-2 min-h-[220px]">
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
                          <TabsContent value="winston" className="bg-muted/50 rounded-lg p-4 mt-2 min-h-[220px]">
                            <CodeBlock
                              language="javascript"
                              code={`import winston from "winston";
import { AbbacchioWinstonTransport } from "@abbacchio/transport/winston";

const logger = winston.createLogger({
  transports: [
    new AbbacchioWinstonTransport({
      url: "${window.location.origin}/api/logs",
      channel: "${activeChannel?.name || 'my-app'}",${activeChannel?.secretKey ? `
      secretKey: "${activeChannel.secretKey}",` : ''}
    }),
  ],
});

logger.info("Hello from Winston!");`}
                            />
                          </TabsContent>
                        </Tabs>
                      </TabsContent>
                      <TabsContent value="python" className="mt-2">
                        <div className="bg-muted/50 rounded-lg p-4 mb-3">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{tLogs('install')}</p>
                          <CodeBlock code="pip install abbacchio" language="bash" />
                        </div>
                        <Tabs defaultValue="logging">
                          <TabsList className="w-full">
                            <TabsTrigger value="logging" className="flex-1">logging</TabsTrigger>
                            <TabsTrigger value="loguru" className="flex-1">loguru</TabsTrigger>
                            <TabsTrigger value="structlog" className="flex-1">structlog</TabsTrigger>
                          </TabsList>
                          <TabsContent value="logging" className="bg-muted/50 rounded-lg p-4 mt-2 min-h-[220px]">
                            <CodeBlock
                              language="python"
                              code={`import logging
from abbacchio.logging import AbbacchioHandler

handler = AbbacchioHandler(
    url="${window.location.origin}/api/logs",
    channel="${activeChannel?.name || 'my-app'}",${activeChannel?.secretKey ? `
    secret_key="${activeChannel.secretKey}",` : ''}
)

logger = logging.getLogger(__name__)
logger.addHandler(handler)
logger.setLevel(logging.DEBUG)

logger.info("Hello from Python!")`}
                            />
                          </TabsContent>
                          <TabsContent value="loguru" className="bg-muted/50 rounded-lg p-4 mt-2 min-h-[220px]">
                            <CodeBlock
                              language="python"
                              code={`from loguru import logger
from abbacchio.loguru import AbbacchioSink

sink = AbbacchioSink(
    url="${window.location.origin}/api/logs",
    channel="${activeChannel?.name || 'my-app'}",${activeChannel?.secretKey ? `
    secret_key="${activeChannel.secretKey}",` : ''}
)

logger.add(sink, format="{message}", level="DEBUG")

logger.info("Hello from loguru!")`}
                            />
                          </TabsContent>
                          <TabsContent value="structlog" className="bg-muted/50 rounded-lg p-4 mt-2 min-h-[220px]">
                            <CodeBlock
                              language="python"
                              code={`import structlog
from abbacchio.structlog import AbbacchioProcessor

processor = AbbacchioProcessor(
    url="${window.location.origin}/api/logs",
    channel="${activeChannel?.name || 'my-app'}",${activeChannel?.secretKey ? `
    secret_key="${activeChannel.secretKey}",` : ''}
)

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        processor,
    ],
)

logger = structlog.get_logger()
logger.info("Hello from structlog!")`}
                            />
                          </TabsContent>
                        </Tabs>
                      </TabsContent>
                      <TabsContent value="http" className="mt-2">
                        <p className="text-sm text-muted-foreground mb-3">{tLogs('empty.welcome.httpDescription')}</p>
                        <div className="bg-muted/50 rounded-lg p-4">
                          <CodeBlock
                            language="bash"
                            code={`curl -X POST ${window.location.origin}/api/logs \\
  -H "Content-Type: application/json" \\
  -H "X-Channel: ${activeChannel?.name || 'my-app'}" \\
  -d '{"level":30,"msg":"Hello from curl!"}'`}
                          />
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Key Dialog */}
        <Dialog open={showKeyDialog} onOpenChange={setShowKeyDialog}>
          <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>{tDialogs('encryptionKey.decryption.title')}</DialogTitle>
              <DialogDescription>
                {tDialogs('encryptionKey.decryption.description')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              {/* Decryption Key Section */}
              <div className="space-y-3">
                <div className="flex gap-2">
                  <SecretKeyInput
                    value={keyInput}
                    onChange={setKeyInput}
                    onKeyDown={(e) => e.key === 'Enter' && applyKey()}
                    placeholder={tDialogs('encryptionKey.decryption.placeholder')}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={async () => {
                      setIsGeneratingKey(true);
                      try {
                        const res = await fetch('/api/generate-key');
                        const data = await res.json();
                        if (data.key) {
                          setKeyInput(data.key);
                        }
                      } catch (err) {
                        console.error('Failed to generate key:', err);
                      } finally {
                        setIsGeneratingKey(false);
                      }
                    }}
                    disabled={isGeneratingKey}
                  >
                    <RefreshCw className={`w-4 h-4 ${isGeneratingKey ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowKeyDialog(false)}
                >
                  {t('actions.close')}
                </Button>
                <Button
                  type="button"
                  onClick={applyKey}
                  disabled={!keyInput.trim()}
                >
                  {tDialogs('encryptionKey.decryption.apply')}
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
                <div className="flex gap-2">
                  <SecretKeyInput
                    value={newChannelKey}
                    onChange={setNewChannelKey}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddChannel()}
                    placeholder={tDialogs('addChannel.keyPlaceholder')}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/generate-key');
                        const data = await res.json();
                        if (data.key) {
                          setNewChannelKey(data.key);
                        }
                      } catch (err) {
                        console.error('Failed to generate key:', err);
                      }
                    }}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
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

        {/* Save Filter Dialog */}
        <SaveFilterDialog
          open={showSaveFilterDialog}
          onOpenChange={setShowSaveFilterDialog}
          onSave={handleSaveFilter}
          currentFilters={{
            levels: levelFilters,
            namespaces: namespaceFilters,
            timeRange,
            search: searchQuery,
            caseSensitive,
            useRegex,
          }}
        />

        {/* Export Dialog */}
        <ExportDialog
          open={showExportDialog}
          onOpenChange={setShowExportDialog}
          onExport={handleExport}
          logCount={filteredCount}
          channelName={activeChannel?.name || ''}
        />

        {/* Command Palette for switching channels and actions */}
        <CommandPalette
          channels={channels}
          activeChannelId={activeChannelId}
          onSelectChannel={setActiveChannelId}
          actions={{
            togglePause: () => setIsPaused(!isPaused),
            isPaused,
            toggleTheme: () => {
              document.documentElement.classList.toggle('dark');
              setIsDark(!isDark);
            },
            isDark,
            switchLanguage: (lang) => i18n.changeLanguage(lang),
            currentLanguage: i18n.language.split('-')[0],
            clearFilters,
            hasActiveFilters: levelFilters.length > 0 || namespaceFilters.length > 0 || searchQuery !== '',
            filterByLevel: toggleLevel,
            copyChannelLink: () => {
              if (!activeChannel) return;
              const params = new URLSearchParams();
              params.set('channel', activeChannel.name);
              if (activeChannel.secretKey) params.set('key', activeChannel.secretKey);
              const link = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
              navigator.clipboard.writeText(link);
              toast.success(tLogs('toast.linkCopied'));
            },
            hasActiveChannel: !!activeChannel?.isConnected,
            focusSearch: () => searchInputRef.current?.focus(),
            toggleSidebar: () => setIsSidebarOpen(!isSidebarOpen),
            isSidebarOpen,
            clearLogs: () => setShowDeleteDialog(true),
            showDatabaseStats: async () => {
              try {
                const stats = await getDatabaseStats();
                const formatSize = (bytes: number) => {
                  if (bytes < 1024) return `${bytes} B`;
                  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
                  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
                };
                toast(tLogs('databaseStats.title'), {
                  description: tLogs('databaseStats.description', {
                    channels: stats.channelCount,
                    records: stats.totalRecords.toLocaleString(),
                    size: formatSize(stats.databaseSize),
                  }),
                  duration: 8000,
                });
              } catch (error) {
                console.error('Failed to get database stats:', error);
                toast.error(tLogs('databaseStats.error'));
              }
            },
          }}
        />

        {/* Data Drawer */}
        <Sheet open={drawerLog !== null} onOpenChange={(open) => !open && setDrawerLog(null)}>
          <SheetContent side="right" className="w-[625px] sm:max-w-[625px] flex flex-col bg-background/80 backdrop-blur-xl border-l border-border">
            <SheetHeader>
              <div className="flex items-center gap-2">
                <SheetTitle>{tLogs('drawer.title')}</SheetTitle>
                {drawerLog && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center">
                        {drawerLog.decryptionFailed ? (
                          <ShieldAlert className="w-4 h-4 text-yellow-500" />
                        ) : drawerLog.wasEncrypted ? (
                          <ShieldCheck className="w-4 h-4 text-green-500" />
                        ) : (
                          <ShieldOff className="w-4 h-4 text-destructive" />
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {drawerLog.decryptionFailed
                        ? tLogs('encryption.decryptionFailed')
                        : drawerLog.wasEncrypted
                          ? tLogs('encryption.encryptedAtSource')
                          : tLogs('encryption.notEncrypted')}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              {drawerLog && (
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 mt-3 text-sm">
                  <span className="text-muted-foreground text-xs self-center">{tLogs('drawer.timestamp')}</span>
                  <span className="font-mono text-xs tabular-nums text-foreground self-center">
                    {new Date(drawerLog.time).toLocaleString()}
                  </span>

                  <span className="text-muted-foreground text-xs self-center">{tLogs('drawer.level')}</span>
                  <div className="self-center"><LevelBadge level={drawerLog.levelLabel} /></div>

                  {drawerLog.namespace && (
                    <>
                      <span className="text-muted-foreground text-xs self-center">{tLogs('drawer.namespace')}</span>
                      <span className="font-mono text-xs text-foreground self-center">
                        {drawerLog.namespace}
                      </span>
                    </>
                  )}

                  <span className="text-muted-foreground text-xs self-start pt-0.5">{tLogs('drawer.message')}</span>
                  <SheetDescription className="font-mono text-xs">
                    {drawerLog.msg}
                  </SheetDescription>
                </div>
              )}
            </SheetHeader>
            <div className="flex-1 overflow-auto mt-4 rounded-lg border border-border/50">
              {drawerLog && (
                <InteractiveJsonView data={drawerLog.data} />
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
