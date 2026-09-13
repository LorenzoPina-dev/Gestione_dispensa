import { useState } from "react";
import type { Notification } from "../types";
import { notifications as mockNotifications } from "../mockData";

export interface UseNotificationsResult {
  notifications: Notification[];
  setNotifications: React.Dispatch<React.SetStateAction<Notification[]>>;
  isDemo: boolean;
  loading: boolean;
}

/**
 * There is no notifications endpoint anywhere in the real backend HTTP surface
 * (apps/api/src/http.ts only wires family/inventory/catalog/shopping) — so this always runs on
 * the bundled demo data. `setNotifications` behaves exactly like the original Figma prototype's
 * local `useState` (read/unread is local-only, same as before).
 */
export function useNotifications(): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
  return { notifications, setNotifications, isDemo: true, loading: false };
}
