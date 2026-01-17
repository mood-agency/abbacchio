import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Plug } from 'lucide-react'

export interface Channel {
  id: string
  name: string
  isConnected: boolean
  isConnecting: boolean
}

interface CommandPaletteProps {
  channels: Channel[]
  activeChannelId: string | null
  onSelectChannel: (channelId: string) => void
}

export function CommandPalette({
  channels,
  activeChannelId,
  onSelectChannel,
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

  const handleSelect = useCallback(
    (value: string) => {
      onSelectChannel(value)
      setOpen(false)
    },
    [onSelectChannel]
  )

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t('switchChannel')} />
      <CommandList>
        <CommandEmpty>{t('noChannels')}</CommandEmpty>
        <CommandGroup heading={t('channels')}>
          {channels.map((channel) => (
            <CommandItem
              key={channel.id}
              value={channel.id}
              keywords={[channel.name]}
              onSelect={handleSelect}
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
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
