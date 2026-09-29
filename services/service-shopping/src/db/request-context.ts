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

