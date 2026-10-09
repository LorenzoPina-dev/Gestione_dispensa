import { useEffect, useMemo, useState } from "react";
import { FAMILY_ID as DEFAULT_FAMILY_ID } from "../api/config";
import * as views from "../api/views";
import { fetchCached, getCached, prefetchCached, subscribeCached } from "../api/screenCache";
import type { ScreenViewBase, FamilyScreenView, NotificationsScreenView } from "../api/views";

export type ScreenKey = "oggi" | "dispensa" | "spesa" | "ricette" | "nutrienti" | "famiglia" | "notifiche";

function key(screen: ScreenKey, familyId: string): string { return `screen:${screen}:${familyId}`; }

function loader(screen: ScreenKey, familyId: string, signal?: AbortSignal) {
  switch (screen) {
    case "oggi": return views.getDashboardView(familyId, signal);
    case "dispensa": return views.getPantryScreenView(familyId, signal);
    case "spesa": return views.getShoppingScreenView(familyId, signal);
    case "ricette": return views.getRecipesScreenView(familyId, signal);
    case "nutrienti": return views.getNutritionScreenView(familyId, signal);
    case "famiglia": return views.getFamilyScreenView(familyId, signal);
    case "notifiche": return views.getNotificationsScreenView(familyId, signal);
  }
}

export function useScreenView(screen: ScreenKey, familyId?: string | null) {
  const effectiveFamilyId = familyId ?? DEFAULT_FAMILY_ID ?? null;
  const cacheKey = effectiveFamilyId ? key(screen, effectiveFamilyId) : null;
  const [data, setData] = useState<ScreenViewBase | FamilyScreenView | NotificationsScreenView | undefined>(
    () => cacheKey ? getCached(cacheKey) : undefined,
  );
  const [loading, setLoading] = useState(Boolean(effectiveFamilyId && !data));
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!cacheKey || !effectiveFamilyId) {
      setData(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setData(getCached(cacheKey));
    const unsubscribe = subscribeCached(cacheKey, (value) => {
      if (!cancelled) setData(value as ScreenViewBase | FamilyScreenView | NotificationsScreenView | undefined);
    });
    setLoading(!getCached(cacheKey));
    const controller = new AbortController();
    fetchCached(cacheKey, () => loader(screen, effectiveFamilyId, controller.signal))
      .then((value) => { if (!cancelled) { setData(value); setError(null); setLoading(false); } })
      .catch((err) => { if (!cancelled && err?.name !== "AbortError") { setError(err); setLoading(false); } });
    return () => { cancelled = true; controller.abort(); unsubscribe(); };
  }, [cacheKey, effectiveFamilyId, screen]);

  return useMemo(() => ({ data, loading, error, cacheKey }), [data, loading, error, cacheKey]);
}

export function prefetchScreenView(screen: ScreenKey, familyId: string): void {
  prefetchCached(key(screen, familyId), () => loader(screen, familyId));
}
