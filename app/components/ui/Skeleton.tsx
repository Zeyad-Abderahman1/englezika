/**
 * app/components/ui/Skeleton.tsx
 *
 * Reusable loading skeleton component.
 * Variants: 'line' | 'block' | 'circle'
 *
 * Pre-composed skeleton layouts are also exported:
 *  - CourseCardSkeleton
 *  - TableRowSkeleton
 *  - StatCardSkeleton
 */

import type { CSSProperties } from 'react';

type SkeletonVariant = 'line' | 'block' | 'circle';

interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({
  variant = 'line',
  width,
  height,
  className = '',
  style,
}: SkeletonProps) {
  const base: CSSProperties = {
    display: 'block',
    background:
      'linear-gradient(90deg, var(--surface-2, rgba(255,255,255,0.06)) 25%, var(--surface-3, rgba(255,255,255,0.12)) 50%, var(--surface-2, rgba(255,255,255,0.06)) 75%)',
    backgroundSize: '200% 100%',
    animation: 'skeleton-shimmer 1.6s ease-in-out infinite',
    borderRadius: variant === 'circle' ? '50%' : variant === 'block' ? '12px' : '6px',
    width: width ?? (variant === 'circle' ? 40 : '100%'),
    height: height ?? (variant === 'circle' ? 40 : variant === 'block' ? 120 : 14),
    flexShrink: 0,
    ...style,
  };
  return (
    <span
      className={`skeleton skeleton--${variant} ${className}`}
      style={base}
      aria-hidden="true"
    />
  );
}

/** Skeleton matching the CourseCard layout */
export function CourseCardSkeleton() {
  return (
    <article
      className="course-card"
      aria-hidden="true"
      style={{ gap: '0.75rem', display: 'flex', flexDirection: 'column' }}
    >
      <Skeleton variant="block" height={140} />
      <Skeleton variant="line" width="60%" height={16} />
      <Skeleton variant="line" width="40%" height={13} />
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
        <Skeleton variant="line" width={70} height={32} style={{ borderRadius: 8 }} />
        <Skeleton variant="line" width={90} height={32} style={{ borderRadius: 8 }} />
      </div>
    </article>
  );
}

/** Skeleton for a single table row */
export function TableRowSkeleton({ cols = 4 }: { cols?: number }) {
  return (
    <tr aria-hidden="true">
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} style={{ padding: '0.75rem 0.5rem' }}>
          <Skeleton variant="line" width={i === 0 ? '80%' : '60%'} height={13} />
        </td>
      ))}
    </tr>
  );
}

/** Skeleton for a stats/count card */
export function StatCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem' }}
    >
      <Skeleton variant="circle" width={32} height={32} />
      <Skeleton variant="line" width="50%" height={12} />
      <Skeleton variant="line" width="35%" height={24} />
    </article>
  );
}
