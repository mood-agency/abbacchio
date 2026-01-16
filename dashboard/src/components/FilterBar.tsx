import type { FilterLevel } from '../types';

interface FilterBarProps {
  levelFilter: FilterLevel;
  setLevelFilter: (level: FilterLevel) => void;
  namespaceFilter: string;
  setNamespaceFilter: (namespace: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onClear: () => void;
  logCount: number;
  filteredCount: number;
}

const levels: FilterLevel[] = ['all', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export function FilterBar({
  levelFilter,
  setLevelFilter,
  namespaceFilter,
  setNamespaceFilter,
  searchQuery,
  setSearchQuery,
  onClear,
  logCount,
  filteredCount,
}: FilterBarProps) {
  const hasFilters = levelFilter !== 'all' || namespaceFilter !== '' || searchQuery !== '';

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
      {/* Level filter */}
      <select
        value={levelFilter}
        onChange={(e) => setLevelFilter(e.target.value as FilterLevel)}
        className="px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        {levels.map((level) => (
          <option key={level} value={level}>
            {level === 'all' ? 'All Levels' : level.charAt(0).toUpperCase() + level.slice(1)}
          </option>
        ))}
      </select>

      {/* Namespace filter */}
      <input
        type="text"
        placeholder="Namespace..."
        value={namespaceFilter}
        onChange={(e) => setNamespaceFilter(e.target.value)}
        className="px-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] w-32"
      />

      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          placeholder="Search logs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={() => {
            setLevelFilter('all');
            setNamespaceFilter('');
            setSearchQuery('');
          }}
          className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          Clear filters
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Log count */}
      <span className="text-sm text-[var(--text-muted)]">
        {filteredCount === logCount
          ? `${logCount} logs`
          : `${filteredCount} of ${logCount} logs`}
      </span>

      {/* Clear logs button */}
      <button
        onClick={onClear}
        className="px-3 py-1.5 rounded-md text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
      >
        Clear
      </button>
    </div>
  );
}
