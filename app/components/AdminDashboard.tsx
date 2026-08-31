'use client';

/**
 * app/components/AdminDashboard.tsx
 *
 * Backwards-compatibility root component forwarding to the redesigned AdminOverviewView
 * wrapped in AdminProvider and AdminShell.
 */

import { AdminProvider } from '../lib/admin-context';
import { AdminShell } from './admin/shell/AdminShell';
import { AdminOverviewView } from './admin/domains/AdminOverviewView';
import '../admin.css';

export default function AdminDashboard() {
  return (
    <AdminProvider>
      <AdminShell>
        <AdminOverviewView />
      </AdminShell>
    </AdminProvider>
  );
}
