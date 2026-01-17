import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Search, X, CaseSensitive } from 'lucide-react';

interface FilterBarProps {
  namespaceFilter: string;
  setNamespaceFilter: (namespace: string) => void;
  availableNamespaces: string[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  matchCount?: number;
  caseSensitive: boolean;
  setCaseSensitive: (value: boolean) => void;
}

export function FilterBar({
  namespaceFilter,
  setNamespaceFilter,
  availableNamespaces,
  searchQuery,
  setSearchQuery,
  matchCount,
  caseSensitive,
  setCaseSensitive,
}: FilterBarProps) {
  const hasFilters = namespaceFilter !== '' || searchQuery !== '';

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/50 relative z-10">
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
      <div className="relative flex-1 max-w-md flex items-center gap-1">
        <div className="relative flex-1">
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-9 w-9 ${caseSensitive ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
              onClick={() => setCaseSensitive(!caseSensitive)}
            >
              <CaseSensitive className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Match case</TooltipContent>
        </Tooltip>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear filters */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setNamespaceFilter('');
            setSearchQuery('');
          }}
          className="text-muted-foreground"
        >
          <X className="w-4 h-4 mr-1" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
