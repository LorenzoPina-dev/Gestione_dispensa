import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboard, type DashboardSummary } from "./dashboard.js";

const emptySummary: DashboardSummary = {
  lowStockCount: 0,
  expiringCount: 0,
  expiredCount: 0,
  activeShoppingListPendingCount: 0,
  unreadNotificationCount: 0,
};

test("dashboard is loading before a summary arrives", () => {
  const model = buildDashboard({ online: true });
  assert.equal(model.state, "LOADING");
  assert.equal(model.alerts.length, 0);
  assert.equal(model.quickActions.length, 0);
});

test("dashboard reports offline explicitly and does not guess a summary", () => {
  const model = buildDashboard({ online: false, summary: emptySummary });
  assert.equal(model.state, "OFFLINE");
  assert.match(model.message, /offline/i);
});

test("dashboard surfaces an explicit error state", () => {
  const model = buildDashboard({ online: true, errorMessage: "The overview could not load." });
  assert.equal(model.state, "ERROR");
  assert.equal(model.message, "The overview could not load.");
});

test("dashboard is empty, not an error, when there is nothing to act on", () => {
  const model = buildDashboard({ online: true, summary: emptySummary });
  assert.equal(model.state, "EMPTY");
  assert.equal(model.alerts.length, 0);
  assert.deepEqual(
    model.quickActions.map((action) => action.id),
    ["ADD_PRODUCT"],
  );
});

test("dashboard prioritizes expired items over every other alert and action", () => {
  const summary: DashboardSummary = {
    lowStockCount: 3,
    expiringCount: 2,
    expiredCount: 1,
    activeShoppingListId: "list-1",
    activeShoppingListPendingCount: 4,
    unreadNotificationCount: 1,
  };
  const model = buildDashboard({ online: true, summary });
  assert.equal(model.state, "READY");
  assert.deepEqual(
    model.alerts.map((alert) => alert.kind),
    ["EXPIRED", "EXPIRING", "LOW_STOCK"],
  );
  assert.equal(model.quickActions[0]?.id, "REVIEW_EXPIRED");
  assert.match(model.message, /expired/);
});

test("dashboard falls back to shopping list and low stock actions without expired/expiring alerts", () => {
  const summary: DashboardSummary = {
    lowStockCount: 2,
    expiringCount: 0,
    expiredCount: 0,
    activeShoppingListId: "list-1",
    activeShoppingListPendingCount: 5,
    unreadNotificationCount: 0,
  };
  const model = buildDashboard({ online: true, summary });
  assert.deepEqual(
    model.quickActions.map((action) => action.id),
    ["REVIEW_SHOPPING_LIST", "REVIEW_LOW_STOCK", "ADD_PRODUCT"],
  );
  assert.match(model.message, /pending items/);
});

test("dashboard never renders a wall of metrics: quick actions stay bounded to relevant items", () => {
  const summary: DashboardSummary = {
    lowStockCount: 0,
    expiringCount: 0,
    expiredCount: 0,
    activeShoppingListPendingCount: 0,
    unreadNotificationCount: 3,
  };
  const model = buildDashboard({ online: true, summary });
  assert.deepEqual(
    model.quickActions.map((action) => action.id),
    ["REVIEW_NOTIFICATIONS", "ADD_PRODUCT"],
  );
});
