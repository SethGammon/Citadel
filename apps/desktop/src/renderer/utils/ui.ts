// Shared UI utilities for the Citadel desktop renderer.
// Import from here instead of duplicating in each screen.

const STATUS_COLOR: Record<string, string> = {
  active: '#3b82f6',
  'in-progress': '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
  parked: '#f59e0b',
  pending: '#555',
  unknown: '#444',
};

export function statusColor(s: string): string {
  return STATUS_COLOR[s] ?? '#444';
}

const WORKTREE_STATUS_COLOR: Record<string, string> = {
  active: '#22c55e',
  merged: '#3b82f6',
  archived: '#6b7280',
};

export function worktreeStatusColor(s: string): string {
  return WORKTREE_STATUS_COLOR[s] ?? '#888';
}

export function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}
