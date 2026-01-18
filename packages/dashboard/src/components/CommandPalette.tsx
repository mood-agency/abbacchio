import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import {
  Plug,
  Pause,
  Play,
  Sun,
  Moon,
  Globe,
  X,
  Link,
  Search,
  PanelLeft,
  PanelLeftClose,
  Trash2,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  Activity,
  Skull,
  Database,
} from 'lucide-react'
import type { LogLevelLabel } from '@/types'

export interface Channel {
  id: string
  name: string
  isConnected: boolean
  isConnecting: boolean
}

export interface CommandPaletteActions {
  togglePause: () => void
  isPaused: boolean
  toggleTheme: () => void
  isDark: boolean
  switchLanguage: (lang: 'en' | 'es') => void
  currentLanguage: string
  clearFilters: () => void
  hasActiveFilters: boolean
  filterByLevel: (level: LogLevelLabel) => void
  copyChannelLink: () => void
  hasActiveChannel: boolean
  focusSearch: () => void
  toggleSidebar: () => void
  isSidebarOpen: boolean
  clearLogs: () => void
  showDatabaseStats: () => void
}

interface CommandPaletteProps {
  channels: Channel[]
  activeChannelId: string | null
  onSelectChannel: (channelId: string) => void
  actions: CommandPaletteActions
}

const LEVEL_ICONS: Record<LogLevelLabel, typeof Info> = {
  trace: Activity,
  debug: Bug,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
  fatal: Skull,
}

export function CommandPalette({
  channels,
  activeChannelId,
  onSelectChannel,
  actions,
}: CommandPaletteProps) {
  const { t } = useTranslation('commands')
  const [open, setOpen] = useState(false)

  // Handle keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const handleChannelSelect = useCallback(
    (value: string) => {
      onSelectChannel(value)
      setOpen(false)
    },
    [onSelectChannel]
  )

  const handleAction = useCallback((callback: () => void) => {
    return () => {
      callback()
      setOpen(false)
    }
  }, [])

  const commands = useMemo(() => {
    const actionCommands = [
      {
        id: 'toggle-pause',
        label: actions.isPaused ? t('actions.resume') : t('actions.pause'),
        icon: actions.isPaused ? Play : Pause,
        shortcut: '⌘P',
        onSelect: handleAction(actions.togglePause),
        keywords: ['pause', 'resume', 'stop', 'start', 'streaming'],
      },
      {
        id: 'focus-search',
        label: t('actions.focusSearch'),
        icon: Search,
        shortcut: '⌘F',
        onSelect: handleAction(actions.focusSearch),
        keywords: ['search', 'find', 'filter', 'buscar'],
      },
      {
        id: 'clear-logs',
        label: t('actions.clearLogs'),
        icon: Trash2,
        onSelect: handleAction(actions.clearLogs),
        keywords: ['clear', 'delete', 'remove', 'logs', 'limpiar', 'borrar'],
        disabled: !actions.hasActiveChannel,
      },
    ]

    const filterCommands = [
      {
        id: 'clear-filters',
        label: t('filters.clear'),
        icon: X,
        onSelect: handleAction(actions.clearFilters),
        keywords: ['clear', 'reset', 'filters', 'limpiar', 'filtros'],
        disabled: !actions.hasActiveFilters,
      },
      ...(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).map((level) => ({
        id: `filter-${level}`,
        label: t(`filters.${level}`),
        icon: LEVEL_ICONS[level],
        onSelect: handleAction(() => actions.filterByLevel(level)),
        keywords: ['filter', 'level', level, 'filtrar', 'nivel'],
      })),
    ]

    const settingsCommands = [
      {
        id: 'toggle-theme',
        label: actions.isDark ? t('settings.lightMode') : t('settings.darkMode'),
        icon: actions.isDark ? Sun : Moon,
        onSelect: handleAction(actions.toggleTheme),
        keywords: ['theme', 'dark', 'light', 'mode', 'tema', 'oscuro', 'claro'],
      },
      {
        id: 'language-en',
        label: t('settings.english'),
        icon: Globe,
        onSelect: handleAction(() => actions.switchLanguage('en')),
        keywords: ['language', 'english', 'en', 'idioma', 'ingles'],
        isActive: actions.currentLanguage === 'en',
      },
      {
        id: 'language-es',
        label: t('settings.spanish'),
        icon: Globe,
        onSelect: handleAction(() => actions.switchLanguage('es')),
        keywords: ['language', 'spanish', 'es', 'espanol', 'idioma'],
        isActive: actions.currentLanguage === 'es',
      },
      {
        id: 'toggle-sidebar',
        label: actions.isSidebarOpen ? t('settings.hideSidebar') : t('settings.showSidebar'),
        icon: actions.isSidebarOpen ? PanelLeftClose : PanelLeft,
        onSelect: handleAction(actions.toggleSidebar),
        keywords: ['sidebar', 'panel', 'toggle', 'barra', 'lateral'],
      },
      {
        id: 'database-stats',
        label: t('settings.databaseStats'),
        icon: Database,
        onSelect: handleAction(actions.showDatabaseStats),
        keywords: ['database', 'stats', 'storage', 'size', 'sqlite', 'base de datos', 'estadisticas', 'almacenamiento'],
      },
    ]

    return { actionCommands, filterCommands, settingsCommands }
  }, [actions, t, handleAction])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t('placeholder')} />
      <CommandList>
        <CommandEmpty>{t('noResults')}</CommandEmpty>

        {/* Channels Group */}
        <CommandGroup heading={t('groups.channels')}>
          {channels.map((channel) => (
            <CommandItem
              key={channel.id}
              value={`channel-${channel.id}`}
              keywords={[channel.name, 'channel', 'switch', 'canal', 'cambiar']}
              onSelect={() => handleChannelSelect(channel.id)}
              className="flex items-center gap-2"
            >
              <Plug className="w-4 h-4 text-muted-foreground" />
              <span>{channel.name}</span>
              <span
                className={`ml-1 w-2 h-2 rounded-full ${
                  channel.isConnected
                    ? 'bg-green-500'
                    : channel.isConnecting
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                }`}
              />
              {activeChannelId === channel.id && (
                <span className="ml-auto text-xs text-muted-foreground">{t('active')}</span>
              )}
            </CommandItem>
          ))}
          {actions.hasActiveChannel && (
            <CommandItem
              value="copy-channel-link"
              keywords={['copy', 'link', 'share', 'channel', 'copiar', 'enlace', 'compartir']}
              onSelect={handleAction(actions.copyChannelLink)}
              className="flex items-center gap-2"
            >
              <Link className="w-4 h-4 text-muted-foreground" />
              <span>{t('channels.copyLink')}</span>
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />

        {/* Actions Group */}
        <CommandGroup heading={t('groups.actions')}>
          {commands.actionCommands.map((cmd) => (
            <CommandItem
              key={cmd.id}
              value={cmd.id}
              keywords={cmd.keywords}
              onSelect={cmd.onSelect}
              disabled={'disabled' in cmd ? cmd.disabled : false}
              className="flex items-center gap-2"
            >
              <cmd.icon className="w-4 h-4 text-muted-foreground" />
              <span>{cmd.label}</span>
              {'shortcut' in cmd && cmd.shortcut && <CommandShortcut>{cmd.shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Filters Group */}
        <CommandGroup heading={t('groups.filters')}>
          {commands.filterCommands.map((cmd) => (
            <CommandItem
              key={cmd.id}
              value={cmd.id}
              keywords={cmd.keywords}
              onSelect={cmd.onSelect}
              disabled={'disabled' in cmd ? cmd.disabled : false}
              className="flex items-center gap-2"
            >
              <cmd.icon className="w-4 h-4 text-muted-foreground" />
              <span>{cmd.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Settings Group */}
        <CommandGroup heading={t('groups.settings')}>
          {commands.settingsCommands.map((cmd) => (
            <CommandItem
              key={cmd.id}
              value={cmd.id}
              keywords={cmd.keywords}
              onSelect={cmd.onSelect}
              className="flex items-center gap-2"
            >
              <cmd.icon className="w-4 h-4 text-muted-foreground" />
              <span>{cmd.label}</span>
              {cmd.isActive && <span className="ml-auto text-xs text-primary">*</span>}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
