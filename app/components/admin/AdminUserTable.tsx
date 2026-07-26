/**
 * app/components/admin/AdminUserTable.tsx
 *
 * Students panel wrapper — re-exports the StudentsPanel inline component
 * as a named export for use by the refactored AdminDashboard layout.
 *
 * The actual implementation (StudentsPanel) is defined within
 * AdminDashboard.tsx due to shared state coupling; this file provides
 * the named interface that the plan expects.
 */

'use client';

export { default as AdminUserTable } from '../AdminDashboard';
