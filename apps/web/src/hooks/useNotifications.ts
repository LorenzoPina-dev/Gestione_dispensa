// apps/web/src/hooks/useNotifications.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Notification } from "../types";
import * as api from "../api/endpoints";

export interface UseNotificationsResult {
  notifications: Notification[];
  setNotifications: React.Dispatch<React.SetStateAction<Notification[]>>;
  isDemo: boolean;
  loading: boolean;
}

export function useNotifications(familyId?: string | null): UseNotificationsResult {
  const [notifications, setNotificationsState] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  // Mirror dello state per calcolare il diff senza doverlo leggere dentro setState.
  const notificationsRef = useRef<Notification[]>([]);
  notificationsRef.current = notifications;

  // Lista di id per cui la chiamata "mark read" è già stata inviata (o non serve inviarla).
  const syncedReadIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!familyId) {
      setNotificationsState([]);
      syncedReadIdsRef.current = new Set();
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.listNotifications(familyId)
      .then((result) => {
        if (cancelled) return;
        const mapped = result.notifications.map((n) => ({
          id: n.id, category: n.category, title: n.title, body: n.body,
          createdAt: n.createdAt, ...(n.readAt ? { readAt: n.readAt } : {}),
        }));
        // Le notifiche già lette al load non vanno ri-sincronizzate: sono già lette sul server.
        for (const n of mapped) if (n.readAt) syncedReadIdsRef.current.add(n.id);
        setNotificationsState(mapped);
      })
      .catch(() => { if (!cancelled) setNotificationsState([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [familyId]);

  // Side effect FUORI dall'updater: parte una volta per transizione reale di `notifications`.
  useEffect(() => {
    if (!familyId) return;
    for (const n of notifications) {
      if (n.readAt && !syncedReadIdsRef.current.has(n.id)) {
        syncedReadIdsRef.current.add(n.id);
        void api.markNotificationRead(familyId, n.id).catch(() => undefined);
      }
    }
  }, [notifications, familyId]);

  const setNotifications = useCallback<React.Dispatch<React.SetStateAction<Notification[]>>>(
    (updater) => {
      // Updater puro: nessun side effect qui dentro.
      setNotificationsState(updater);
    },
    [],
  );

  return { notifications, setNotifications, isDemo: false, loading };
}