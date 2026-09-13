export type DashboardState = "LOADING" | "READY" | "EMPTY" | "OFFLINE" | "ERROR";

export type DashboardAlertKind = "EXPIRED" | "EXPIRING" | "LOW_STOCK";

export interface DashboardAlert {
  readonly kind: DashboardAlertKind;
  readonly count: number;
}

export interface DashboardSummary {
  readonly lowStockCount: number;
  readonly expiringCount: number;
  readonly expiredCount: number;
  readonly activeShoppingListId?: string;
  readonly activeShoppingListPendingCount: number;
  readonly unreadNotificationCount: number;
}

export type DashboardQuickActionId =
  | "REVIEW_EXPIRED"
  | "REVIEW_EXPIRING"
  | "REVIEW_LOW_STOCK"
  | "REVIEW_SHOPPING_LIST"
  | "REVIEW_NOTIFICATIONS"
  | "ADD_PRODUCT";

export interface DashboardQuickAction {
  readonly id: DashboardQuickActionId;
  readonly href: string;
  readonly label: string;
}

export interface DashboardModel {
  readonly state: DashboardState;
  readonly alerts: readonly DashboardAlert[];
  readonly quickActions: readonly DashboardQuickAction[];
  readonly message: string;
}

const QUICK_ACTION_ORDER: readonly {
  readonly id: DashboardQuickActionId;
  readonly href: string;
  readonly label: string;
  readonly applies: (summary: DashboardSummary) => boolean;
}[] = [
  {
    id: "REVIEW_EXPIRED",
    href: "/inventory?filter=expired",
    label: "Review expired items",
    applies: (summary) => summary.expiredCount > 0,
  },
  {
    id: "REVIEW_EXPIRING",
    href: "/inventory?filter=expiring",
    label: "Review items expiring soon",
    applies: (summary) => summary.expiringCount > 0,
  },
  {
    id: "REVIEW_SHOPPING_LIST",
    href: "/shopping",
    label: "Review the shopping list",
    applies: (summary) =>
      summary.activeShoppingListId !== undefined && summary.activeShoppingListPendingCount > 0,
  },
  {
    id: "REVIEW_LOW_STOCK",
    href: "/inventory?filter=low-stock",
    label: "Review low stock",
    applies: (summary) => summary.lowStockCount > 0,
  },
  {
    id: "REVIEW_NOTIFICATIONS",
    href: "/notifications",
    label: "Review notifications",
    applies: (summary) => summary.unreadNotificationCount > 0,
  },
  {
    id: "ADD_PRODUCT",
    href: "/inventory/add",
    label: "Add a product",
    applies: () => true,
  },
];

/**
 * Builds the dashboard overview. The dashboard prioritizes actionable items over raw metrics:
 * quick actions are ordered by urgency (expired, then expiring, then the active shopping list,
 * then low stock, then notifications) and always fall back to "add a product" so the panel is
 * never empty for an active family with no alerts.
 */
export function buildDashboard(input: {
  readonly online: boolean;
  readonly errorMessage?: string;
  readonly summary?: DashboardSummary;
}): DashboardModel {
  if (input.errorMessage !== undefined) {
    return { state: "ERROR", alerts: [], quickActions: [], message: input.errorMessage };
  }
  if (!input.online) {
    return {
      state: "OFFLINE",
      alerts: [],
      quickActions: [],
      message: "You are offline. Showing the last synced overview is unavailable right now.",
    };
  }
  if (input.summary === undefined) {
    return { state: "LOADING", alerts: [], quickActions: [], message: "Loading your overview." };
  }

  const summary = input.summary;
  const alerts: DashboardAlert[] = [];
  if (summary.expiredCount > 0) alerts.push({ kind: "EXPIRED", count: summary.expiredCount });
  if (summary.expiringCount > 0) alerts.push({ kind: "EXPIRING", count: summary.expiringCount });
  if (summary.lowStockCount > 0) alerts.push({ kind: "LOW_STOCK", count: summary.lowStockCount });

  const quickActions = QUICK_ACTION_ORDER.filter((candidate) => candidate.applies(summary)).map(
    (candidate) => ({ id: candidate.id, href: candidate.href, label: candidate.label }),
  );

  if (alerts.length === 0 && summary.activeShoppingListPendingCount === 0) {
    return {
      state: "EMPTY",
      alerts,
      quickActions,
      message: "Nothing needs attention right now. Add a product to get started.",
    };
  }

  return { state: "READY", alerts, quickActions, message: dashboardHeadline(alerts) };
}

function dashboardHeadline(alerts: readonly DashboardAlert[]): string {
  const expired = alerts.find((alert) => alert.kind === "EXPIRED");
  if (expired !== undefined) {
    return `${expired.count} item${expired.count === 1 ? "" : "s"} expired and need${expired.count === 1 ? "s" : ""} a decision.`;
  }
  const expiring = alerts.find((alert) => alert.kind === "EXPIRING");
  if (expiring !== undefined) {
    return `${expiring.count} item${expiring.count === 1 ? "" : "s"} expiring soon.`;
  }
  const lowStock = alerts.find((alert) => alert.kind === "LOW_STOCK");
  if (lowStock !== undefined) {
    return `${lowStock.count} item${lowStock.count === 1 ? "" : "s"} running low.`;
  }
  return "Your shopping list has pending items.";
}
