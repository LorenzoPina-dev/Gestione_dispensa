/**
 * Lightweight in-memory pub/sub for background sync failures (inventory movements, shopping
 * item updates, ...). Lets the hooks report a problem with a retry action attached, and lets a
 * single UI banner (components/SyncIssuesBanner.tsx) show it and let the person retry or dismiss
 * it, instead of the failure being silently swallowed into a console.warn.
 *
 * Deliberately in-memory only (not persisted to localStorage): the retry action is a closure
 * over the original request, which can't be serialized across a page reload. If the tab is
 * closed before retrying, the issue is lost — the next successful list/read will simply reflect
 * whatever the backend actually has. This is a scope simplification, not a bug: a fully durable
 * offline queue would need to serialize commands (not closures) and is a larger feature.
 */

export interface SyncIssue {
  id: string;
  /** Which part of the app this came from, shown as a small label. */
  domain: "inventory" | "shopping" | "family";
  /** Short, person-facing description of what failed. */
  message: string;
  /** Whether retrying makes sense (false for e.g. permanent validation errors). */
  retryable: boolean;
  /** Re-attempts the same operation. Resolves/rejects like the original call. */
  retry: () => Promise<void>;
  createdAt: number;
}

type Listener = (issues: SyncIssue[]) => void;

let issues: SyncIssue[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener([...issues]);
}

export function reportSyncIssue(issue: Omit<SyncIssue, "id" | "createdAt">): string {
  const id = `${issue.domain}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  issues = [...issues, { ...issue, id, createdAt: Date.now() }];
  emit();
  return id;
}

export function dismissSyncIssue(id: string): void {
  issues = issues.filter((i) => i.id !== id);
  emit();
}

export async function retrySyncIssue(id: string): Promise<void> {
  const issue = issues.find((i) => i.id === id);
  if (!issue) return;
  try {
    await issue.retry();
    dismissSyncIssue(id);
  } catch {
    // Leave the issue in place — the person can retry again or dismiss it.
  }
}

export function subscribeSyncIssues(listener: Listener): () => void {
  listeners.add(listener);
  listener([...issues]);
  return () => listeners.delete(listener);
}
