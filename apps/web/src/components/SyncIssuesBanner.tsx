import { useEffect, useState } from "react";
import { colors } from "../tokens";
import { dismissSyncIssue, retrySyncIssue, subscribeSyncIssues, type SyncIssue } from "../lib/syncBus";

const DOMAIN_LABEL: Record<SyncIssue["domain"], string> = {
  inventory: "Dispensa",
  shopping: "Spesa",
  family: "Famiglia",
};

/**
 * Small stack of dismissible banners for background sync failures (a movement that hit a
 * VERSION_CONFLICT, a role change that couldn't reach the backend, ...). The optimistic UI
 * update already happened — this only tells the person their change might not be saved
 * server-side yet, and offers a one-tap retry.
 */
export default function SyncIssuesBanner() {
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useEffect(() => subscribeSyncIssues(setIssues), []);

  if (issues.length === 0) return null;

  return (
    <div className="px-4 pt-2 space-y-1.5">
      {issues.map((issue) => (
        <div
          key={issue.id}
          className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs"
          style={{ backgroundColor: colors.terracottaLight, color: colors.terracotta }}
        >
          <span className="font-semibold shrink-0">{DOMAIN_LABEL[issue.domain]}</span>
          <span className="flex-1 min-w-0">{issue.message}</span>
          {issue.retryable && (
            <button
              onClick={async () => {
                setRetryingId(issue.id);
                await retrySyncIssue(issue.id);
                setRetryingId(null);
              }}
              disabled={retryingId === issue.id}
              className="shrink-0 px-2.5 py-1 rounded-lg font-semibold transition-all hover:opacity-80"
              style={{ backgroundColor: colors.terracotta, color: colors.white }}
            >
              {retryingId === issue.id ? "…" : "Riprova"}
            </button>
          )}
          <button
            onClick={() => dismissSyncIssue(issue.id)}
            className="shrink-0 text-sm"
            aria-label="Ignora"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
