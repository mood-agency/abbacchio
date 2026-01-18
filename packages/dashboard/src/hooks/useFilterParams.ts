import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';
import type { LogLevelLabel, FilterLevels, FilterNamespaces, TimeRange } from '../types';
import { TIME_RANGE_OPTIONS } from '../types';

const VALID_LEVELS: LogLevelLabel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const VALID_TIME_RANGES = Object.keys(TIME_RANGE_OPTIONS) as TimeRange[];

function isValidLevel(level: string): level is LogLevelLabel {
  return VALID_LEVELS.includes(level as LogLevelLabel);
}

function isValidTimeRange(range: string): range is TimeRange {
  return VALID_TIME_RANGES.includes(range as TimeRange);
}

export interface FilterParams {
  levels: FilterLevels;
  namespaces: FilterNamespaces;
  timeRange: TimeRange;
  search: string;
  caseSensitive: boolean;
}

export interface UseFilterParamsResult extends FilterParams {
  setLevels: (levels: FilterLevels) => void;
  toggleLevel: (level: LogLevelLabel) => void;
  setNamespaces: (namespaces: FilterNamespaces) => void;
  toggleNamespace: (namespace: string) => void;
  setTimeRange: (range: TimeRange) => void;
  setSearch: (search: string) => void;
  setCaseSensitive: (caseSensitive: boolean) => void;
  clearFilters: () => void;
  hasFilters: boolean;
}

/**
 * Hook to sync filter state with URL query parameters using react-router-dom
 *
 * URL params:
 * - levels: Comma-separated log levels (trace,debug,info,warn,error,fatal)
 * - namespaces: Comma-separated namespaces
 * - time: Time range (30m, 1h, 12h, 1d, 3d, 1w, 2w, all)
 * - q: Search query
 * - case: Case sensitivity (1 for true)
 */
export function useFilterParams(): UseFilterParamsResult {
  const [searchParams, setSearchParams] = useSearchParams();

  // Parse current params
  const params = useMemo((): FilterParams => {
    const levelsParam = searchParams.get('levels') || '';
    const levels = levelsParam
      .split(',')
      .filter((l) => l && isValidLevel(l)) as FilterLevels;

    const namespacesParam = searchParams.get('namespaces') || '';
    const namespaces = namespacesParam
      .split(',')
      .filter((n) => n.trim() !== '') as FilterNamespaces;

    const timeParam = searchParams.get('time') || 'all';
    const timeRange = isValidTimeRange(timeParam) ? timeParam : 'all';

    const search = searchParams.get('q') || '';
    const caseSensitive = searchParams.get('case') === '1';

    return { levels, namespaces, timeRange, search, caseSensitive };
  }, [searchParams]);

  // Update a single param while preserving others (including channel/key)
  const updateParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === '') {
            next.delete(key);
          } else {
            next.set(key, value);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setLevels = useCallback(
    (levels: FilterLevels) => {
      updateParam('levels', levels.length > 0 ? levels.join(',') : null);
    },
    [updateParam]
  );

  const toggleLevel = useCallback(
    (level: LogLevelLabel) => {
      const currentLevels = params.levels;
      const newLevels = currentLevels.includes(level)
        ? currentLevels.filter((l) => l !== level)
        : [...currentLevels, level];
      setLevels(newLevels);
    },
    [params.levels, setLevels]
  );

  const setNamespaces = useCallback(
    (namespaces: FilterNamespaces) => {
      updateParam('namespaces', namespaces.length > 0 ? namespaces.join(',') : null);
    },
    [updateParam]
  );

  const toggleNamespace = useCallback(
    (namespace: string) => {
      const currentNamespaces = params.namespaces;
      const newNamespaces = currentNamespaces.includes(namespace)
        ? currentNamespaces.filter((n) => n !== namespace)
        : [...currentNamespaces, namespace];
      setNamespaces(newNamespaces);
    },
    [params.namespaces, setNamespaces]
  );

  const setTimeRange = useCallback(
    (range: TimeRange) => {
      updateParam('time', range === 'all' ? null : range);
    },
    [updateParam]
  );

  const setSearch = useCallback(
    (search: string) => updateParam('q', search || null),
    [updateParam]
  );

  const setCaseSensitive = useCallback(
    (caseSensitive: boolean) => updateParam('case', caseSensitive ? '1' : null),
    [updateParam]
  );

  const clearFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('levels');
        next.delete('namespaces');
        next.delete('time');
        next.delete('q');
        next.delete('case');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const hasFilters =
    params.levels.length > 0 ||
    params.namespaces.length > 0 ||
    params.timeRange !== 'all' ||
    params.search !== '' ||
    params.caseSensitive;

  return {
    ...params,
    setLevels,
    toggleLevel,
    setNamespaces,
    toggleNamespace,
    setTimeRange,
    setSearch,
    setCaseSensitive,
    clearFilters,
    hasFilters,
  };
}
