'use client';

/**
 * app/components/admin/shell/AdminLoadingSkeleton.tsx
 *
 * Content skeleton animations for data tables, metric grids, and cards.
 */

export function AdminLoadingSkeleton({
  type = 'table',
  rows = 5,
}: {
  type?: 'table' | 'cards' | 'metrics';
  rows?: number;
}) {
  if (type === 'metrics') {
    return (
      <div className="admin-skeleton-metrics" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="admin-skeleton-metric-card" />
        ))}
      </div>
    );
  }

  if (type === 'cards') {
    return (
      <div className="admin-skeleton-cards" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="admin-skeleton-card" />
        ))}
      </div>
    );
  }

  return (
    <div className="admin-skeleton-table" aria-hidden="true">
      <div className="admin-skeleton-table-header" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="admin-skeleton-table-row" />
      ))}
    </div>
  );
}
