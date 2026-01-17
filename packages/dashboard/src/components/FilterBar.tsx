import type { FilterLevel } from '../types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X } from 'lucide-react';

interface FilterBarProps {
  levelFilter: FilterLevel;
  setLevelFilter: (level: FilterLevel) => void;
  namespaceFilter: string;
  setNamespaceFilter: (namespace: string) => void;
  availableNamespaces: string[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  logCount: number;
  filteredCount: number;
  matchCount?: number;
}

const levels: FilterLevel[] = ['all', 'trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export function FilterBar({
  levelFilter,
  setLevelFilter,
  namespaceFilter,
  setNamespaceFilter,
  availableNamespaces,
  searchQuery,
  setSearchQuery,
  logCount,
  filteredCount,
  matchCount,
}: FilterBarProps) {
  const hasFilters = levelFilter !== 'all' || namespaceFilter !== '' || searchQuery !== '';

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/50 relative z-10">
      {/* Level filter */}
      <Select value={levelFilter} onValueChange={(value) => setLevelFilter(value as FilterLevel)}>
        <SelectTrigger className="w-[130px] h-9">
          <SelectValue placeholder="All Levels" />
        </SelectTrigger>
        <SelectContent>
          {levels.map((level) => (
            <SelectItem key={level} value={level}>
              {level === 'all' ? 'All Levels' : level.charAt(0).toUpperCase() + level.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Namespace filter */}
      <Select
        value={namespaceFilter || 'all'}
        onValueChange={(value) => setNamespaceFilter(value === 'all' ? '' : value)}
      >
        <SelectTrigger className="w-[160px] h-9">
          <SelectValue placeholder="All Namespaces" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Namespaces</SelectItem>
          {availableNamespaces.map((namespace) => (
            <SelectItem key={namespace} value={namespace}>
              {namespace}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search logs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 pr-3 h-9"
        />
        {searchQuery && matchCount !== undefined && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {matchCount} {matchCount === 1 ? 'match' : 'matches'}
          </span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear filters */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLevelFilter('all');
            setNamespaceFilter('');
            setSearchQuery('');
          }}
          className="text-muted-foreground"
        >
          <X className="w-4 h-4 mr-1" />
          Clear filters
        </Button>
      )}

      {/* Log count */}
      <span className="text-sm text-muted-foreground">
        {filteredCount === logCount
          ? `${logCount} logs`
          : `${filteredCount} of ${logCount} logs`}
      </span>
    </div>
  );
}
