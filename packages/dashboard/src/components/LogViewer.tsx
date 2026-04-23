import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { usePolling } from '../hooks/usePolling';
import { useFilterParams } from '../hooks/useFilterParams';
import { useSavedFilters } from '../hooks/useSavedFilters';
import type { LogEntry } from '../types';
import { TIME_RANGE_OPTIONS } from '../types';
import { FilterBar } from './FilterBar';
import { LogSidebar } from './LogSidebar';
import { SaveFilterDialog } from './SaveFilterDialog';
import { ExportDialog } from './ExportDialog';
import { LogRow } from './LogRow';
import { LevelBadge } from './ui/CustomBadge';
import { CommandPalette } from './CommandPalette';
import { LanguageSwitcher } from './LanguageSwitcher';
import { formatLogsForClipboard, downloadLogs, type ExportFormat } from '@/lib/format-logs';
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
import {
  Sun,
  Moon,
  FileText,
  Loader2,
  ChevronDown,
  Radio,
  Check,
  Minus,
  MoreVertical,
  Link,
  Trash2,
  SearchX,
  Download,
  ArrowDown,
} from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { MetricsViewer } from './MetricsViewer';
import { TracesViewer } from './TracesViewer';
import { SqlQueryPanel } from './SqlQueryPanel';
import { Activity, GitCommitVertical, FileText as LogsIcon } from 'lucide-react';

// Compute level counts from logs in memory
function computeLevelCounts(logs: LogEntry[]) {
  const counts = { all: logs.length, trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0 };
  for (const log of logs) {
    const label = log.levelLabel;
    if (label in counts) counts[label as keyof typeof counts]++;
  }
  return counts;
}

// Compute namespace counts from logs in memory
function computeNamespaceCounts(logs: LogEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const log of logs) {
    const ns = log.namespace || '(none)';
    counts[ns] = (counts[ns] || 0) + 1;
  }
  return counts;
}

interface LogViewerProps {
  activeView: 'logs' | 'metrics' | 'traces';
  onViewChange: (view: 'logs' | 'metrics' | 'traces') => void;
}

export function LogViewer({ activeView, onViewChange }: LogViewerProps) {
  const { t, i18n } = useTranslation();
  const { t: tLogs } = useTranslation('logs');
  const { t: tDialogs } = useTranslation('dialogs');
  const { t: tFilters } = useTranslation('filters');

  // Read initial channel and paused state from URL
  const [searchParams, setSearchParams] = useSearchParams();
  const initialChannel = searchParams.get('channel');
  const initialPaused = searchParams.get('paused') === '1';

  // URL params for filters (must be before usePolling so filters are available)
  const {
    levels: levelFilters,
    namespaces: namespaceFilters,
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
    timeRange,
  } = useFilterParams();

  // Server-side filters derived from URL params
  const serverFilters = useMemo(() => ({
    levels: levelFilters.length > 0 ? levelFilters : undefined,
    namespaces: namespaceFilters.length > 0 ? namespaceFilters : undefined,
  }), [levelFilters, namespaceFilters]);

  // Simple polling-based data
  const {
    channels,
    activeChannel,
    setActiveChannel: setActiveChannelRaw,
    addChannel,
    deleteChannel,
    logs: allLogs,
    metrics,
    traces,
    isLoading,
    isPaused,
    setIsPaused: setIsPausedRaw,
    clearLogs,
    loadOlderLogs,
    hasMoreOlderLogs,
    isLoadingOlder,
    serverTotal,
    serverLevelCounts,
    serverNamespaceCounts,
  } = usePolling(initialChannel, initialPaused, serverFilters);

  // Sync isPaused to URL
  const setIsPaused = useCallback((paused: boolean) => {
    setIsPausedRaw(paused);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (paused) {
        next.set('paused', '1');
      } else {
        next.delete('paused');
      }
      return next;
    }, { replace: true });
  }, [setIsPausedRaw, setSearchParams]);

  // Sync activeChannel to URL
  const setActiveChannel = useCallback((name: string) => {
    setActiveChannelRaw(name);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('channel', name);
      return next;
    }, { replace: true });
  }, [setActiveChannelRaw, setSearchParams]);

  // Keep URL in sync whenever activeChannel changes (auto-select, addChannel, etc.)
  useEffect(() => {
    if (activeChannel && searchParams.get('channel') !== activeChannel) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('channel', activeChannel);
        return next;
      }, { replace: true });
    }
  }, [activeChannel, searchParams, setSearchParams]);

  // Apply client-side filters (level/namespace are now server-side)
  const logs = useMemo(() => {
    let filtered = allLogs;

    // Time range filter
    const rangeMs = TIME_RANGE_OPTIONS[timeRange];
    if (rangeMs > 0) {
      const minTime = Date.now() - rangeMs;
      filtered = filtered.filter(log => log.time >= minTime);
    }

    // Search filter
    if (searchQuery) {
      if (useRegex) {
        try {
          const regex = new RegExp(searchQuery, caseSensitive ? '' : 'i');
          filtered = filtered.filter(log =>
            regex.test(log.msg) || regex.test(JSON.stringify(log.data))
          );
        } catch {
          // Invalid regex, skip filtering
        }
      } else {
        const query = caseSensitive ? searchQuery : searchQuery.toLowerCase();
        filtered = filtered.filter(log => {
          const msg = caseSensitive ? log.msg : log.msg.toLowerCase();
          const data = caseSensitive ? JSON.stringify(log.data) : JSON.stringify(log.data).toLowerCase();
          return msg.includes(query) || data.includes(query);
        });
      }
    }

    return filtered;
  }, [allLogs, searchQuery, useRegex, caseSensitive, timeRange]);

  // Base logs filtered by time range and search (but NOT by level/namespace)
  // so sidebar counts reflect what's actually visible
  const baseFilteredLogs = useMemo(() => {
    let filtered = allLogs;

    // Time range filter
    const rangeMs = TIME_RANGE_OPTIONS[timeRange];
    if (rangeMs > 0) {
      const minTime = Date.now() - rangeMs;
      filtered = filtered.filter(log => log.time >= minTime);
    }

    // Search filter
    if (searchQuery) {
      if (useRegex) {
        try {
          const regex = new RegExp(searchQuery, caseSensitive ? '' : 'i');
          filtered = filtered.filter(log =>
            regex.test(log.msg) || regex.test(JSON.stringify(log.data))
          );
        } catch {
          // Invalid regex, skip filtering
        }
      } else {
        const query = caseSensitive ? searchQuery : searchQuery.toLowerCase();
        filtered = filtered.filter(log => {
          const msg = caseSensitive ? log.msg : log.msg.toLowerCase();
          const data = caseSensitive ? JSON.stringify(log.data) : JSON.stringify(log.data).toLowerCase();
          return msg.includes(query) || data.includes(query);
        });
      }
    }

    return filtered;
  }, [allLogs, timeRange, searchQuery, useRegex, caseSensitive]);

  // Compute counts from base filtered logs (respects time range + search, but not level/namespace)
  const levelCounts = useMemo(() => computeLevelCounts(baseFilteredLogs), [baseFilteredLogs]);
  const namespaceCounts = useMemo(() => computeNamespaceCounts(baseFilteredLogs), [baseFilteredLogs]);
  const availableNamespaces = useMemo(() => Object.keys(namespaceCounts), [namespaceCounts]);

  // Theme state
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Delete confirmation dialog (clear logs)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Delete channel confirmation dialog
  const [showDeleteChannelDialog, setShowDeleteChannelDialog] = useState(false);
  const [channelToDelete, setChannelToDelete] = useState<string | null>(null);

  // Add channel dialog
  const [showAddChannelDialog, setShowAddChannelDialog] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  // Save filter dialog
  const [showSaveFilterDialog, setShowSaveFilterDialog] = useState(false);

  // Export dialog state
  const [showExportDialog, setShowExportDialog] = useState(false);

  // Saved filters hook
  const { savedFilters, saveFilter, deleteFilter } = useSavedFilters(activeChannel);

  // Row selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // Data drawer state
  const [drawerLog, setDrawerLog] = useState<LogEntry | null>(null);

  // Sidebar visibility state
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // SQL mode state
  const [sqlMode, setSqlMode] = useState(false);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      searchQuery.length > 0 ||
      levelFilters.length > 0 ||
      namespaceFilters.length > 0 ||
      timeRange !== 'all'
    );
  }, [searchQuery, levelFilters, namespaceFilters, timeRange]);

  // Validate regex
  const regexError = useMemo(() => {
    if (!useRegex || !searchQuery) return null;
    try {
      new RegExp(searchQuery);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid regex';
    }
  }, [useRegex, searchQuery]);

  // Handle row selection
  const handleRowSelect = useCallback((logId: string, shiftKey: boolean) => {
    if (shiftKey && lastSelectedId !== null) {
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

  // Handle select all
  const handleSelectAll = useCallback(() => {
    if (logs.length === 0) return;
    if (selectedIds.size > 0) {
      setSelectedIds(new Set());
      setLastSelectedId(null);
    } else {
      setSelectedIds(new Set(logs.map(log => log.id)));
      setLastSelectedId(logs[logs.length - 1]?.id ?? null);
    }
  }, [logs, selectedIds.size]);

  const selectAllState = useMemo(() => {
    if (logs.length === 0 || selectedIds.size === 0) return 'none';
    if (selectedIds.size === logs.length) return 'all';
    return 'some';
  }, [logs.length, selectedIds.size]);

  // Copy selected logs
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

  // Keyboard shortcuts
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

  // Add new channel
  const handleAddChannel = () => {
    if (!newChannelName.trim()) {
      toast.error(tLogs('toast.channelNameRequired'));
      return;
    }
    addChannel(newChannelName.trim());
    setShowAddChannelDialog(false);
    setNewChannelName('');
    toast.success(tLogs('toast.connected', { channel: newChannelName.trim() }));
  };

  // Scroll container ref
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll: sticky to bottom until user scrolls up
  const [isAtBottom, setIsAtBottom] = useState(true);
  const prevLogCountRef = useRef(logs.length);

  // Track new log IDs for highlight animation (only for appended logs, not prepended)
  const [newLogIds, setNewLogIds] = useState<Set<string>>(new Set());
  const prevAllLogsLastIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (allLogs.length === 0) {
      prevAllLogsLastIdRef.current = null;
      return;
    }
    const lastId = allLogs[allLogs.length - 1].id;
    const prevLastId = prevAllLogsLastIdRef.current;
    // Only highlight if the last log changed (i.e., new logs appended at the end)
    if (prevLastId && lastId !== prevLastId) {
      const prevIdx = allLogs.findIndex(l => l.id === prevLastId);
      if (prevIdx !== -1 && prevIdx < allLogs.length - 1) {
        const newIds = new Set<string>();
        for (let i = prevIdx + 1; i < allLogs.length; i++) {
          newIds.add(allLogs[i].id);
        }
        setNewLogIds(newIds);
        const timer = setTimeout(() => setNewLogIds(new Set()), 2000);
        prevAllLogsLastIdRef.current = lastId;
        return () => clearTimeout(timer);
      }
    }
    prevAllLogsLastIdRef.current = lastId;
  }, [allLogs]);

  // Search input ref for Ctrl+F focus
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Handle Ctrl+F
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

  // Virtualization
  const rowVirtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 28,
    overscan: 20,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  // Track scroll position to detect if user is at bottom
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 50;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      setIsAtBottom(atBottom);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll position preservation when older logs are prepended
  const prevFirstLogIdRef = useRef<string | null>(null);
  const prevLogLengthRef = useRef(0);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || logs.length === 0) {
      prevFirstLogIdRef.current = logs[0]?.id ?? null;
      prevLogLengthRef.current = logs.length;
      return;
    }

    const prevFirstId = prevFirstLogIdRef.current;
    const currentFirstId = logs[0]?.id;
    const prevLen = prevLogLengthRef.current;

    // Detect prepend: first log ID changed and array got longer
    if (prevFirstId && currentFirstId && prevFirstId !== currentFirstId && logs.length > prevLen) {
      const prependedCount = logs.length - prevLen;
      // Adjust scrollTop so the user stays looking at the same row
      requestAnimationFrame(() => {
        el.scrollTop += prependedCount * 28; // estimateSize
      });
    }

    prevFirstLogIdRef.current = currentFirstId;
    prevLogLengthRef.current = logs.length;
  }, [logs]);

  // Auto-scroll to bottom when new logs arrive (appended) and user is at bottom
  useEffect(() => {
    if (logs.length > prevLogCountRef.current && isAtBottom) {
      // Use requestAnimationFrame to ensure virtualizer has updated
      requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(logs.length - 1, { align: 'end' });
      });
    }
    prevLogCountRef.current = logs.length;
  }, [logs.length, isAtBottom, rowVirtualizer]);

  // Scroll to bottom when initial load completes
  useEffect(() => {
    if (!isLoading && logs.length > 0) {
      requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(logs.length - 1, { align: 'end' });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Scroll-to-top detection for loading older logs
  const loadOlderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleScrollForOlder = () => {
      const nearTop = el.scrollTop < 200;
      if (nearTop && hasMoreOlderLogs && !isLoadingOlder) {
        if (!loadOlderTimeoutRef.current) {
          loadOlderTimeoutRef.current = setTimeout(() => {
            loadOlderLogs();
            loadOlderTimeoutRef.current = null;
          }, 150);
        }
      } else if (loadOlderTimeoutRef.current) {
        clearTimeout(loadOlderTimeoutRef.current);
        loadOlderTimeoutRef.current = null;
      }
    };

    el.addEventListener('scroll', handleScrollForOlder, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScrollForOlder);
      if (loadOlderTimeoutRef.current) {
        clearTimeout(loadOlderTimeoutRef.current);
      }
    };
  }, [hasMoreOlderLogs, isLoadingOlder, loadOlderLogs]);

  // Handle delete confirmation
  const handleConfirmDelete = useCallback(async () => {
    await clearLogs(activeChannel || undefined);
    setShowDeleteDialog(false);
    toast.success(tLogs('toast.logsDeleted'));
  }, [activeChannel, clearLogs, tLogs]);

  // Handle delete channel confirmation
  const handleConfirmDeleteChannel = useCallback(async () => {
    if (!channelToDelete) return;
    try {
      await deleteChannel(channelToDelete);
      setShowDeleteChannelDialog(false);
      setChannelToDelete(null);
      toast.success(tDialogs('deleteChannel.toast'));
    } catch {
      toast.error(tDialogs('deleteChannel.error'));
    }
  }, [channelToDelete, deleteChannel, tDialogs]);

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
    downloadLogs(logs, format, activeChannel);
    toast.success(tFilters('export.toast.success'));
  }, [logs, activeChannel, tFilters]);

  return (
    <TooltipProvider delayDuration={300}>
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
                          <span>{activeChannel}</span>
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {channels.map((channel) => (
                          <DropdownMenuItem
                            key={channel.name}
                            onClick={() => setActiveChannel(channel.name)}
                            className={`${channel.name === activeChannel ? 'bg-accent' : ''} group`}
                          >
                            <span className="truncate max-w-[200px]">{channel.name}</span>
                            <span className="ml-auto flex items-center gap-1">
                              {channel.name === activeChannel ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <span className="w-3.5 h-3.5" />
                              )}
                              {channel.name !== 'default' ? (
                                <button
                                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setChannelToDelete(channel.name);
                                    setShowDeleteChannelDialog(true);
                                  }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <span className="w-4.5" />
                              )}
                            </span>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            setNewChannelName('');
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
            <LanguageSwitcher />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const next = !isDark;
                    document.documentElement.classList.toggle('dark');
                    localStorage.setItem('theme', next ? 'dark' : 'light');
                    setIsDark(next);
                  }}
                >
                  {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('theme.toggleDarkMode')}</TooltipContent>
            </Tooltip>
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
                  <DropdownMenuItem
                    onClick={() => {
                      if (logs.length === 0) {
                        toast.error(tFilters('export.toast.noLogs'));
                        return;
                      }
                      setShowExportDialog(true);
                    }}
                    disabled={logs.length === 0}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    {tFilters('export.tooltip')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      const params = new URLSearchParams(window.location.search);
                      params.set('channel', activeChannel);
                      const link = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
                      navigator.clipboard.writeText(link);
                      toast.success(tLogs('toast.linkCopied'));
                    }}
                  >
                    <Link className="w-4 h-4 mr-2" />
                    {tFilters('tooltips.copyLink')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowDeleteDialog(true)}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    {tFilters('tooltips.clearLogs')}
                  </DropdownMenuItem>
                  {activeChannel !== 'default' && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => {
                          setChannelToDelete(activeChannel);
                          setShowDeleteChannelDialog(true);
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {tDialogs('deleteChannel.menuItem')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        {/* View switcher tabs */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-muted/30">
          <button
            onClick={() => onViewChange('logs')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeView === 'logs'
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
          >
            <LogsIcon className="w-3.5 h-3.5" />
            Logs
          </button>
          <button
            onClick={() => onViewChange('metrics')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeView === 'metrics'
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Metrics
          </button>
          <button
            onClick={() => onViewChange('traces')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeView === 'traces'
              ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
              : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              }`}
          >
            <GitCommitVertical className="w-3.5 h-3.5" />
            Traces
          </button>

        </div>

        {/* Conditionally render views */}
        {activeView === 'metrics' ? (
          <MetricsViewer metrics={metrics} channelName={activeChannel} />
        ) : activeView === 'traces' ? (
          <TracesViewer traces={traces} channelName={activeChannel} />
        ) : (
          /* Main content with sidebar */
          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar */}
            {(logs.length > 0 || hasActiveFilters) && isSidebarOpen && (
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
                loadedCount={allLogs.length}
                serverTotal={serverTotal}
                serverLevelCounts={serverLevelCounts}
                serverNamespaceCounts={serverNamespaceCounts}
              />
            )}

            {/* Log content area */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Filter bar */}
              {(logs.length > 0 || hasActiveFilters || sqlMode) && (
                <FilterBar
                  ref={searchInputRef}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
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
                  sqlMode={sqlMode}
                  onToggleSqlMode={() => setSqlMode(!sqlMode)}
                />
              )}

              {/* SQL Query Panel */}
              {sqlMode && (
                <SqlQueryPanel />
              )}

              {/* Log table */}
              {sqlMode ? null : logs.length > 0 ? (
                <>
                  {/* Column headers */}
                  <div className="flex items-center text-xs font-medium text-muted-foreground tracking-wider border-y border-border bg-background relative z-10">
                    <div
                      className="w-10 flex-shrink-0 border-r border-border py-2 flex items-center justify-center cursor-pointer hover:bg-muted/50"
                      onClick={handleSelectAll}
                    >
                      <div className={`w-4 h-4 rounded border ${selectAllState !== 'none' ? 'bg-primary border-primary' : 'border-muted-foreground/50'} flex items-center justify-center transition-colors`}>
                        {selectAllState === 'all' && <Check className="w-3 h-3 text-primary-foreground" />}
                        {selectAllState === 'some' && <Minus className="w-3 h-3 text-primary-foreground" />}
                      </div>
                    </div>
                    <div className="flex-1 flex items-center gap-3 px-4 py-2">
                      <span className="w-40 flex-shrink-0">{tLogs('drawer.timestamp')}</span>
                      <span className="w-16 flex-shrink-0">Level</span>
                      <span className="w-28 flex-shrink-0">Namespace</span>
                      <span className="w-96 flex-shrink-0">Message</span>
                      <span className="flex-1">Data</span>
                    </div>
                  </div>

                  {/* Virtual log list */}
                  <div className="flex flex-1 overflow-hidden">
                    <div className="flex-1 relative">
                      <ScrollArea
                        className="h-full"
                        viewPortRef={scrollContainerRef}
                      >
                        {/* Loading older logs indicator */}
                        {hasMoreOlderLogs && (
                          <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
                            {isLoadingOlder ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                Loading older logs...
                              </>
                            ) : (
                              <span className="opacity-50">Scroll up to load more</span>
                            )}
                          </div>
                        )}
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
                      {/* Scroll to bottom button */}
                      {!isAtBottom && (
                        <button
                          onClick={() => rowVirtualizer.scrollToIndex(logs.length - 1, { align: 'end' })}
                          className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                          New logs
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                /* Empty state */
                <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
                  {isLoading ? (
                    <>
                      <Loader2 className="w-16 h-16 mb-4 opacity-50 animate-spin" />
                      <p className="text-lg">{tLogs('empty.loading')}</p>
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

                      <Tabs defaultValue="otlp" className="text-left">
                        <TabsList className="w-full">
                          <TabsTrigger value="otlp" className="flex-1">OTLP (Pino)</TabsTrigger>
                          <TabsTrigger value="http" className="flex-1">HTTP</TabsTrigger>
                        </TabsList>
                        <TabsContent value="otlp" className="mt-2">
                          <div className="bg-muted/50 rounded-lg p-4 mb-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{tLogs('install')}</p>
                            <CodeBlock code="npm install pino pino-opentelemetry-transport" language="bash" />
                          </div>
                          <div className="bg-muted/50 rounded-lg p-4">
                            <CodeBlock
                              language="javascript"
                              code={`import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-opentelemetry-transport",
    options: {
      loggerName: "my-app",
      resourceAttributes: {
        "service.name": "${activeChannel || 'my-app'}",
      },
    },
  },
});

// Set env vars:
// OTEL_EXPORTER_OTLP_ENDPOINT=${window.location.origin}
// OTEL_EXPORTER_OTLP_PROTOCOL=http/json

logger.info("Hello from Pino OTLP!");`}
                            />
                          </div>
                        </TabsContent>
                        <TabsContent value="http" className="mt-2">
                          <p className="text-sm text-muted-foreground mb-3">{tLogs('empty.welcome.httpDescription')}</p>
                          <div className="bg-muted/50 rounded-lg p-4">
                            <CodeBlock
                              language="bash"
                              code={`curl -X POST ${window.location.origin}/api/logs \\
  -H "Content-Type: application/json" \\
  -H "X-Channel: ${activeChannel || 'my-app'}" \\
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
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{tDialogs('deleteConfirmation.title', { channel: activeChannel })}</DialogTitle>
              <DialogDescription>
                {tDialogs('deleteConfirmation.description')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setShowDeleteDialog(false)}>
                {t('actions.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleConfirmDelete}>
                {tDialogs('deleteConfirmation.deleteAll')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Channel Confirmation Dialog */}
        <Dialog open={showDeleteChannelDialog} onOpenChange={setShowDeleteChannelDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{tDialogs('deleteChannel.title', { channel: channelToDelete })}</DialogTitle>
              <DialogDescription>
                {tDialogs('deleteChannel.description')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setShowDeleteChannelDialog(false)}>
                {t('actions.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleConfirmDeleteChannel}>
                {tDialogs('deleteChannel.confirm')}
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
          logCount={logs.length}
          channelName={activeChannel || ''}
        />

        {/* Command Palette */}
        <CommandPalette
          channels={channels.map(ch => ({
            id: ch.name,
            name: ch.name,
            secretKey: '',
            isConnected: true,
            isConnecting: false,
            connectionError: null,
            hasEncryptedLogs: false,
          }))}
          activeChannelId={activeChannel}
          onSelectChannel={(id) => setActiveChannel(id)}
          actions={{
            togglePause: () => setIsPaused(!isPaused),
            isPaused,
            toggleTheme: () => {
              const next = !isDark;
              document.documentElement.classList.toggle('dark');
              localStorage.setItem('theme', next ? 'dark' : 'light');
              setIsDark(next);
            },
            isDark,
            switchLanguage: (lang) => i18n.changeLanguage(lang),
            currentLanguage: i18n.language.split('-')[0],
            clearFilters,
            hasActiveFilters: levelFilters.length > 0 || namespaceFilters.length > 0 || searchQuery !== '',
            filterByLevel: toggleLevel,
            copyChannelLink: () => {
              if (!activeChannel) return;
              const params = new URLSearchParams(window.location.search);
              params.set('channel', activeChannel);
              const link = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
              navigator.clipboard.writeText(link);
              toast.success(tLogs('toast.linkCopied'));
            },
            hasActiveChannel: !!activeChannel,
            focusSearch: () => searchInputRef.current?.focus(),
            toggleSidebar: () => setIsSidebarOpen(!isSidebarOpen),
            isSidebarOpen,
            clearLogs: () => setShowDeleteDialog(true),
            showDatabaseStats: async () => {
              try {
                const res = await fetch('/api/stats');
                const data = await res.json();
                const stats = data.channels;
                toast(`Server Stats`, {
                  description: `${stats.channelCount} channels, ${stats.channels?.reduce((sum: number, ch: { logCount: number }) => sum + ch.logCount, 0) || 0} total logs`,
                  duration: 5000,
                });
              } catch {
                toast.error('Failed to fetch stats');
              }
            },
          }}
        />

        {/* Data Drawer */}
        <Sheet open={drawerLog !== null} onOpenChange={(open) => !open && setDrawerLog(null)}>
          <SheetContent side="right" className="w-[625px] sm:max-w-[625px] flex flex-col bg-background/80 backdrop-blur-xl border-l border-border">
            <SheetHeader>
              <SheetTitle>{tLogs('drawer.title')}</SheetTitle>
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
