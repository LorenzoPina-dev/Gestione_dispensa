/**
 * Small stale-while-revalidate cache used by screen composite views.
 * It intentionally lives behind a tiny interface so TanStack Query can replace it without
 * changing page/domain code once dependencies are available in the deployment environment.
 */
type Listener<T> = (value: T | undefined) => void;

interface Entry<T> {
  value?: T;
  updatedAt: number;
  promise?: Promise<T>;
  listeners: Set<Listener<T>>;
}

const cache = new Map<string, Entry<unknown>>();

export function getCached<T>(key: string): T | undefined {
  return cache.get(key)?.value as T | undefined;
}

export function subscribeCached<T>(key: string, listener: Listener<T>): () => void {
  let entry = cache.get(key);
  if (!entry) {
    entry = { updatedAt: 0, listeners: new Set() };
    cache.set(key, entry);
  }
  entry.listeners.add(listener as Listener<unknown>);
  return () => entry?.listeners.delete(listener as Listener<unknown>);
}

export function invalidateCached(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.updatedAt = 0;
  for (const listener of entry.listeners) listener(entry.value);
}

export async function fetchCached<T>(key: string, loader: () => Promise<T>, staleMs = 30_000): Promise<T> {
  let entry = cache.get(key) as Entry<T> | undefined;
  if (!entry) {
    entry = { updatedAt: 0, listeners: new Set() };
    cache.set(key, entry as Entry<unknown>);
  }
  if (entry.promise) return entry.promise;
  if (entry.value !== undefined && Date.now() - entry.updatedAt < staleMs) return entry.value;

  entry.promise = loader().then((value) => {
    entry!.value = value;
    entry!.updatedAt = Date.now();
    entry!.promise = undefined;
    for (const listener of entry!.listeners) listener(value);
    return value;
  }).catch((error) => {
    entry!.promise = undefined;
    throw error;
  });
  return entry.promise;
}

export function prefetchCached<T>(key: string, loader: () => Promise<T>): void {
  void fetchCached(key, loader);
}
