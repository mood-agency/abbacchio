import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';
import type { FilterLevel } from '../types';

const VALID_LEVELS = ['all', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

function isValidLevel(level: string): level is FilterLevel {
  return VALID_LEVELS.includes(level as FilterLevel);
}

export interface FilterParams {
  level: FilterLevel;
  namespace: string;
  search: string;
  caseSensitive: boolean;
}

export interface UseFilterParamsResult extends FilterParams {
  setLevel: (level: FilterLevel) => void;
  setNamespace: (namespace: string) => void;
  setSearch: (search: string) => void;
  setCaseSensitive: (caseSensitive: boolean) => void;
  clearFilters: () => void;
  hasFilters: boolean;
}

/**
 * Hook to sync filter state with URL query parameters using react-router-dom
 *
 * URL params:
 * - level: Log level filter (trace, debug, info, warn, error, fatal)
 * - namespace: Namespace filter
 * - q: Search query
 * - case: Case sensitivity (1 for true)
 */
export function useFilterParams(): UseFilterParamsResult {
  const [searchParams, setSearchParams] = useSearchParams();

  // Parse current params
  const params = useMemo((): FilterParams => {
    const levelParam = searchParams.get('level') || 'all';
    const level = isValidLevel(levelParam) ? levelParam : 'all';
    const namespace = searchParams.get('namespace') || '';
    const search = searchParams.get('q') || '';
    const caseSensitive = searchParams.get('case') === '1';

    return { level, namespace, search, caseSensitive };
  }, [searchParams]);

  // Update a single param while preserving others (including channel/key)
  const updateParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === '' || value === 'all' || value === '0') {
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

  const setLevel = useCallback(
    (level: FilterLevel) => updateParam('level', level === 'all' ? null : level),
    [updateParam]
  );

  const setNamespace = useCallback(
    (namespace: string) => updateParam('namespace', namespace || null),
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
        next.delete('level');
        next.delete('namespace');
        next.delete('q');
        next.delete('case');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const hasFilters =
    params.level !== 'all' ||
    params.namespace !== '' ||
    params.search !== '' ||
    params.caseSensitive;

  return {
    ...params,
    setLevel,
    setNamespace,
    setSearch,
    setCaseSensitive,
    clearFilters,
    hasFilters,
  };
}
