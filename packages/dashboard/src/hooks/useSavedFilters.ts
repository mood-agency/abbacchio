import { useState, useCallback, useEffect } from 'react';
import type { FilterLevels, FilterNamespaces, TimeRange } from '../types';

export interface SavedFilter {
  id: string;
  name: string;
  levels: FilterLevels;
  namespaces: FilterNamespaces;
  timeRange: TimeRange;
  search: string;
  caseSensitive: boolean;
  useRegex: boolean;
  createdAt: number;
}

export interface SavedFiltersPerChannel {
  [channelId: string]: SavedFilter[];
}

const STORAGE_KEY = 'abbacchio-saved-filters';

function loadSavedFilters(): SavedFiltersPerChannel {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load saved filters:', error);
  }
  return {};
}

function persistSavedFilters(filters: SavedFiltersPerChannel): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch (error) {
    console.error('Failed to persist saved filters:', error);
  }
}

export interface UseSavedFiltersResult {
  /** List of saved filters for the current channel */
  savedFilters: SavedFilter[];
  /** Save current filter configuration with a name */
  saveFilter: (name: string, filter: Omit<SavedFilter, 'id' | 'name' | 'createdAt'>) => void;
  /** Delete a saved filter by ID */
  deleteFilter: (filterId: string) => void;
  /** Get a saved filter by ID */
  getFilter: (filterId: string) => SavedFilter | undefined;
}

export function useSavedFilters(channelId: string | null): UseSavedFiltersResult {
  const [allFilters, setAllFilters] = useState<SavedFiltersPerChannel>(loadSavedFilters);

  // Load filters from localStorage on mount
  useEffect(() => {
    setAllFilters(loadSavedFilters());
  }, []);

  // Get filters for current channel
  const savedFilters = channelId ? (allFilters[channelId] || []) : [];

  const saveFilter = useCallback(
    (name: string, filter: Omit<SavedFilter, 'id' | 'name' | 'createdAt'>) => {
      if (!channelId) return;

      const newFilter: SavedFilter = {
        ...filter,
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
      };

      setAllFilters((prev) => {
        const channelFilters = prev[channelId] || [];
        const updated = {
          ...prev,
          [channelId]: [...channelFilters, newFilter],
        };
        persistSavedFilters(updated);
        return updated;
      });
    },
    [channelId]
  );

  const deleteFilter = useCallback(
    (filterId: string) => {
      if (!channelId) return;

      setAllFilters((prev) => {
        const channelFilters = prev[channelId] || [];
        const updated = {
          ...prev,
          [channelId]: channelFilters.filter((f) => f.id !== filterId),
        };
        persistSavedFilters(updated);
        return updated;
      });
    },
    [channelId]
  );

  const getFilter = useCallback(
    (filterId: string): SavedFilter | undefined => {
      return savedFilters.find((f) => f.id === filterId);
    },
    [savedFilters]
  );

  return {
    savedFilters,
    saveFilter,
    deleteFilter,
    getFilter,
  };
}
