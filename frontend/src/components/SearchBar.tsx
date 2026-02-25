import * as React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Project } from 'shared/types';

interface SearchBarProps {
  className?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  onClear?: () => void;
  project: Project | null;
}

export const SearchBar = React.forwardRef<HTMLInputElement, SearchBarProps>(
  (
    { className, value = '', onChange, disabled = false, onClear, project },
    ref
  ) => {
    if (disabled) {
      return null;
    }

    return (
      <div className={cn('relative w-64 sm:w-72', className)}>
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={ref}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          placeholder={project ? `Search ${project.name}...` : 'Search...'}
          className="h-8 bg-muted pl-8 pr-8"
        />
        {value && onClear ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-all duration-150 hover:scale-105 hover:bg-foreground/10 hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    );
  }
);

SearchBar.displayName = 'SearchBar';
