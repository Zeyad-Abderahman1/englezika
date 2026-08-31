'use client';

/**
 * app/components/admin/shell/AdminFilterBar.tsx
 *
 * Unified search and filter toolbar for tables and catalogs.
 */

import { type ReactNode } from 'react';
import { Search, X } from 'lucide-react';

interface AdminFilterBarProps {
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  onSearchSubmit?: () => void;
  filters?: ReactNode;
  actions?: ReactNode;
  resultCount?: number;
  onClearFilters?: () => void;
}

export function AdminFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'ابحث...',
  onSearchSubmit,
  filters,
  actions,
  resultCount,
  onClearFilters,
}: AdminFilterBarProps) {
  return (
    <div className="admin-filter-bar">
      <div className="admin-filter-inputs">
        {onSearchChange && (
          <div className="admin-search-wrapper">
            <Search className="admin-search-icon" size={16} aria-hidden="true" />
            <input
              type="search"
              className="admin-search-input"
              value={searchValue || ''}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && onSearchSubmit) {
                  e.preventDefault();
                  onSearchSubmit();
                }
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
            {searchValue && (
              <button
                type="button"
                className="admin-search-clear"
                onClick={() => onSearchChange('')}
                aria-label="مسح البحث"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        {filters}
        {onClearFilters && (
          <button
            type="button"
            className="btn btn-ghost btn-sm admin-clear-filters-btn"
            onClick={onClearFilters}
          >
            إعادة ضبط
          </button>
        )}
      </div>

      <div className="admin-filter-meta">
        {typeof resultCount === 'number' && (
          <span className="admin-result-count">
            <strong>{resultCount}</strong> نتيجة
          </span>
        )}
        {actions && <div className="admin-filter-actions">{actions}</div>}
      </div>
    </div>
  );
}
