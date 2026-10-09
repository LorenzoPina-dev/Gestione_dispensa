import { AsyncLocalStorage } from "node:async_hooks";

export interface DbRequestContext {
  readonly userId?: string;
  readonly familyId?: string;
}

const storage = new AsyncLocalStorage<DbRequestContext>();

export function setDbRequestContext(context: DbRequestContext): void {
  storage.enterWith(context);
}

export function getDbRequestContext(): DbRequestContext {
  return storage.getStore() ?? {};
}


function headerValue(headers: Headers | NodeJS.Dict<string | string[] | undefined>, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function setDbRequestContextFromHeaders(
  headers: Headers | NodeJS.Dict<string | string[] | undefined>,
): void {
  const userId = headerValue(headers, "x-user-id")?.trim();
  const familyId = headerValue(headers, "x-family-id")?.trim();
  setDbRequestContext({
    ...(userId ? { userId } : {}),
    ...(familyId ? { familyId } : {}),
  });
}
