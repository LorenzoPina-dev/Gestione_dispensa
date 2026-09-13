import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { FamilyController, toFamilyHttpError, type FamilyHttpMeta } from "./family/controller.js";
import type { InviteRole } from "./family/invites.js";
import {
  InventoryController,
  toInventoryHttpError,
  type InventoryHttpMeta,
} from "./inventory/controller.js";
import type { InventoryUnit, MovementKind } from "./inventory/service.js";
import { CatalogController, toCatalogHttpError, type CatalogHttpMeta } from "./catalog/controller.js";
import type { IdentifierType, ProductUnit } from "./catalog/service.js";
import {
  ShoppingController,
  toShoppingHttpError,
  type ShoppingHttpMeta,
} from "./shopping/controller.js";
import type { ShoppingSourceType } from "./shopping/service.js";
import { OidcTokenVerifier } from "./identity/oidc.js";

export interface PostgresLiveness {
  ping(): Promise<boolean>;
}

export interface FamilyRouteDependencies {
  controller: FamilyController;
  /**
   * Verifies the Authorization header and returns a Principal. Invalid or
   * missing credentials must resolve to `undefined` rather than throwing, so
   * public routes (invite resolve) keep working and protected routes can
   * apply FamilyController's own 401 handling uniformly.
   */
  verifier: OidcTokenVerifier;
}

export interface InventoryRouteDependencies {
  controller: InventoryController;
  verifier: OidcTokenVerifier;
}

export interface CatalogRouteDependencies {
  controller: CatalogController;
  verifier: OidcTokenVerifier;
}

export interface ShoppingRouteDependencies {
  controller: ShoppingController;
  verifier: OidcTokenVerifier;
}

export interface ApiServerOptions {
  version: string;
  profile: string;
  startedAt?: string;
  /**
   * When provided, /health/ready reports a real liveness probe instead of
   * the static "not-configured" placeholder.
   */
  postgres?: PostgresLiveness;
  /**
   * When provided, wires the family domain HTTP surface (create family,
   * create/resolve/accept invite). When omitted, those routes are simply
   * not registered and behave like any other unknown path (404).
   */
  family?: FamilyRouteDependencies;
  /**
   * When provided, wires the inventory domain HTTP surface (list stock
   * items, create stock item, record movement). When omitted, those routes
   * are simply not registered and behave like any other unknown path (404).
   */
  inventory?: InventoryRouteDependencies;
  /**
   * When provided, wires the catalog domain HTTP surface (create manual
   * product, resolve barcode). Catalog data is shared reference data, not
   * family-scoped, so only authentication (not family membership) gates
   * writes; barcode lookup is public.
   */
  catalog?: CatalogRouteDependencies;
  /**
   * When provided, wires the shopping domain HTTP surface (get active list,
   * create list, add item).
   */
  shopping?: ShoppingRouteDependencies;
}

const FAMILY_INVITES_PATTERN = /^\/api\/v1\/families\/([^/]+)\/invites$/;
const INVITE_ACCEPT_PATTERN = /^\/api\/v1\/invites\/([^/]+)\/accept$/;
const STOCK_MOVEMENT_PATTERN = /^\/api\/v1\/inventory\/stock-items\/([^/]+)\/movements$/;
const SHOPPING_LIST_ITEMS_PATTERN = /^\/api\/v1\/shopping\/lists\/([^/]+)\/items$/;
const MAX_BODY_BYTES = 1_000_000;

export function createApiServer(options: ApiServerOptions) {
  const startedAt = options.startedAt ?? new Date().toISOString();

  return createServer((request, response) => {
    handleRequest(request, response, options, startedAt).catch((error: unknown) => {
      if (!response.headersSent) {
        const meta = buildMeta(request);
        writeJson(
          response,
          500,
          failure("INTERNAL_ERROR", "The request could not be completed.", meta),
        );
      }
      // eslint-disable-next-line no-console -- last-resort diagnostic for an otherwise-swallowed failure
      console.error("unhandled_request_error", error);
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ApiServerOptions,
  startedAt: string,
): Promise<void> {
  const meta = buildMeta(request);
  response.setHeader("x-request-id", meta.requestId);
  response.setHeader("traceparent", `00-${meta.traceId}-0000000000000001-01`);

  const url = new URL(request.url ?? "/", "http://api.local");
  const path = url.pathname;
  const method = request.method ?? "GET";

  if (path === "/health/live") {
    return requireGet(method, response, meta, () =>
      writeJson(response, 200, {
        data: { status: "ok", service: "api", version: options.version },
        meta,
      }),
    );
  }

  if (path === "/health/ready") {
    return requireGet(method, response, meta, async () => {
      const postgres = options.postgres
        ? ((await options.postgres.ping()) ? "ok" : "unreachable")
        : "not-configured";
      writeJson(response, 200, {
        data: {
          status: "ready",
          service: "api",
          version: options.version,
          dependencies: { postgres, redis: "not-configured" },
        },
        meta,
      });
    });
  }

  if (path === "/api/v1/meta") {
    return requireGet(method, response, meta, () =>
      writeJson(response, 200, {
        data: {
          name: "gestione-dispensa-api",
          version: options.version,
          contract: "api/v1",
          profile: options.profile,
          startedAt,
        },
        meta,
      }),
    );
  }

  if (options.family !== undefined) {
    const family = options.family;

    if (path === "/api/v1/families") {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, family.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseCreateFamilyBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          family.controller.createFamily(principal, { ...parsed, traceId: meta.traceId }, meta),
          toFamilyHttpError,
        );
      });
    }

    const invitesMatch = FAMILY_INVITES_PATTERN.exec(path);
    if (invitesMatch !== undefined && invitesMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, family.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseCreateInviteBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          family.controller.createInvite(principal, invitesMatch[1], parsed, meta),
          toFamilyHttpError,
        );
      });
    }

    if (path === "/api/v1/invites/resolve") {
      return requirePost(method, response, meta, async () => {
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseResolveInviteBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          family.controller.resolveInvite(
            parsed.token,
            parsed.browserBindingHash,
            meta.traceId,
            meta,
          ),
          toFamilyHttpError,
        );
      });
    }

    const acceptMatch = INVITE_ACCEPT_PATTERN.exec(path);
    if (acceptMatch !== undefined && acceptMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, family.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseAcceptInviteBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          family.controller.acceptInvite(principal, acceptMatch[1], parsed.consentVersion, meta),
          toFamilyHttpError,
        );
      });
    }
  }

  if (options.inventory !== undefined) {
    const inventory = options.inventory;

    if (path === "/api/v1/inventory/stock-items") {
      if (method === "GET") {
        return requireGet(method, response, meta, async () => {
          const principal = await resolvePrincipal(request, inventory.verifier);
          const familyId = url.searchParams.get("familyId");
          if (familyId === null || familyId.trim().length === 0) {
            writeJson(
              response,
              400,
              failure("VALIDATION_ERROR", "Query parameter familyId is required.", meta),
            );
            return;
          }
          await respond(
            response,
            meta,
            inventory.controller.listStockItems(principal, familyId, meta),
            toInventoryHttpError,
          );
        });
      }
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, inventory.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseCreateStockItemBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          inventory.controller.createStockItem(principal, { ...parsed, traceId: meta.traceId }, meta),
          toInventoryHttpError,
        );
      });
    }

    const movementMatch = STOCK_MOVEMENT_PATTERN.exec(path);
    if (movementMatch !== undefined && movementMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, inventory.verifier);
        const ifMatch = request.headers["if-match"];
        if (typeof ifMatch !== "string" || ifMatch.trim().length === 0) {
          writeJson(
            response,
            428,
            failure("PRECONDITION_REQUIRED", "An If-Match header with the current version is required.", meta),
          );
          return;
        }
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseRecordMovementBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          inventory.controller.recordMovement(
            principal,
            { ...parsed, stockItemId: movementMatch[1], traceId: meta.traceId },
            ifMatch,
            meta,
          ),
          toInventoryHttpError,
        );
      });
    }
  }

  if (options.catalog !== undefined) {
    const catalog = options.catalog;

    if (path === "/api/v1/catalog/products") {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, catalog.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseCreateProductBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          catalog.controller.createProduct(principal, { ...parsed, traceId: meta.traceId }, meta),
          toCatalogHttpError,
        );
      });
    }

    if (path === "/api/v1/catalog/lookup") {
      return requireGet(method, response, meta, async () => {
        const identifierType = url.searchParams.get("identifierType");
        const value = url.searchParams.get("value");
        const validTypes: readonly IdentifierType[] = [
          "EAN8",
          "EAN13",
          "GTIN12",
          "GTIN14",
          "SKU",
          "BARCODE",
        ];
        if (
          identifierType === null ||
          !validTypes.includes(identifierType as IdentifierType) ||
          value === null ||
          value.trim().length === 0
        ) {
          writeJson(
            response,
            400,
            failure(
              "VALIDATION_ERROR",
              "Query parameters identifierType and value are required.",
              meta,
            ),
          );
          return;
        }
        await respond(
          response,
          meta,
          catalog.controller.lookupBarcode(identifierType as IdentifierType, value, meta),
          toCatalogHttpError,
        );
      });
    }
  }

  if (options.shopping !== undefined) {
    const shopping = options.shopping;

    if (path === "/api/v1/shopping/lists/active") {
      return requireGet(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, shopping.verifier);
        const familyId = url.searchParams.get("familyId");
        if (familyId === null || familyId.trim().length === 0) {
          writeJson(
            response,
            400,
            failure("VALIDATION_ERROR", "Query parameter familyId is required.", meta),
          );
          return;
        }
        await respond(
          response,
          meta,
          shopping.controller.getActiveList(principal, familyId, meta),
          toShoppingHttpError,
        );
      });
    }

    if (path === "/api/v1/shopping/lists") {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, shopping.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseCreateShoppingListBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          shopping.controller.createList(principal, { ...parsed, traceId: meta.traceId }, meta),
          toShoppingHttpError,
        );
      });
    }

    const itemsMatch = SHOPPING_LIST_ITEMS_PATTERN.exec(path);
    if (itemsMatch !== undefined && itemsMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, shopping.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseAddShoppingItemBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          shopping.controller.addItem(
            principal,
            { ...parsed, listId: itemsMatch[1], traceId: meta.traceId },
            meta,
          ),
          toShoppingHttpError,
        );
      });
    }
  }

  writeJson(response, 404, failure("NOT_FOUND_OR_NOT_VISIBLE", "The resource is not available.", meta));
}

async function respond<Meta extends FamilyHttpMeta>(
  response: ServerResponse,
  meta: Meta,
  work: Promise<{ data: unknown; meta: Meta }>,
  toHttpError: (
    error: unknown,
    meta: Meta,
  ) => { status: number; body: { error: { code: string; message: string; retryable: boolean }; meta: Meta } },
): Promise<void> {
  try {
    const result = await work;
    writeJson(response, 200, result);
  } catch (error) {
    const { status, body } = toHttpError(error, meta);
    writeJson(response, status, body);
  }
}

async function resolvePrincipal(request: IncomingMessage, verifier: OidcTokenVerifier) {
  try {
    return await verifier.verifyAuthorizationHeader(request.headers.authorization);
  } catch {
    return undefined;
  }
}

function requireGet(
  method: string,
  response: ServerResponse,
  meta: FamilyHttpMeta,
  handler: () => void | Promise<void>,
): void | Promise<void> {
  if (method !== "GET") {
    writeJson(response, 405, failure("METHOD_NOT_ALLOWED", "The HTTP method is not allowed.", meta));
    return;
  }
  return handler();
}

function requirePost(
  method: string,
  response: ServerResponse,
  meta: FamilyHttpMeta,
  handler: () => void | Promise<void>,
): void | Promise<void> {
  if (method !== "POST") {
    writeJson(response, 405, failure("METHOD_NOT_ALLOWED", "The HTTP method is not allowed.", meta));
    return;
  }
  return handler();
}

async function readJsonBody(
  request: IncomingMessage,
  response: ServerResponse,
  meta: FamilyHttpMeta,
): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      writeJson(response, 413, failure("PAYLOAD_TOO_LARGE", "The request body is too large.", meta));
      return undefined;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim().length === 0) {
    writeJson(response, 400, failure("VALIDATION_ERROR", "A JSON request body is required.", meta));
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      writeJson(response, 400, failure("VALIDATION_ERROR", "The request body must be a JSON object.", meta));
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is not valid JSON.", meta));
    return undefined;
  }
}

function parseCreateFamilyBody(
  body: Record<string, unknown>,
): { displayName: string; locale: string; timezone: string; unitSystem: "METRIC" | "IMPERIAL" } | undefined {
  const { displayName, locale, timezone, unitSystem } = body;
  if (
    typeof displayName !== "string" ||
    typeof locale !== "string" ||
    typeof timezone !== "string" ||
    (unitSystem !== "METRIC" && unitSystem !== "IMPERIAL")
  ) {
    return undefined;
  }
  return { displayName, locale, timezone, unitSystem };
}

function parseCreateInviteBody(body: Record<string, unknown>) {
  const { role, expiresInSeconds } = body;
  const roles: readonly InviteRole[] = ["MANAGER", "MEMBER", "VIEWER"];
  if (
    typeof role !== "string" ||
    !roles.includes(role as InviteRole) ||
    typeof expiresInSeconds !== "number" ||
    !Number.isFinite(expiresInSeconds)
  ) {
    return undefined;
  }
  return { role: role as InviteRole, expiresInSeconds };
}

function parseResolveInviteBody(body: Record<string, unknown>) {
  const { token, browserBindingHash } = body;
  if (typeof token !== "string" || token.length === 0) return undefined;
  if (typeof browserBindingHash !== "string" || !/^[0-9a-f]{16,128}$/i.test(browserBindingHash)) {
    return undefined;
  }
  return { token, browserBindingHash };
}

function parseAcceptInviteBody(body: Record<string, unknown>) {
  const { consentVersion } = body;
  if (typeof consentVersion !== "string" || consentVersion.trim().length === 0) return undefined;
  return { consentVersion };
}

const INVENTORY_UNITS: readonly InventoryUnit[] = ["g", "kg", "ml", "l", "piece", "pack"];
const MOVEMENT_KINDS: readonly MovementKind[] = [
  "RECEIPT",
  "CONSUMPTION",
  "WASTE",
  "ADJUSTMENT",
  "TRANSFER",
];

function parseCreateStockItemBody(body: Record<string, unknown>):
  | {
      familyId: string;
      productId: string;
      packageId?: string;
      locationId?: string;
      quantity: number;
      unit: InventoryUnit;
      reorderPoint?: number;
    }
  | undefined {
  const { familyId, productId, packageId, locationId, quantity, unit, reorderPoint } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    typeof productId !== "string" ||
    productId.length === 0 ||
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    typeof unit !== "string" ||
    !INVENTORY_UNITS.includes(unit as InventoryUnit) ||
    (packageId !== undefined && typeof packageId !== "string") ||
    (locationId !== undefined && typeof locationId !== "string") ||
    (reorderPoint !== undefined && (typeof reorderPoint !== "number" || !Number.isFinite(reorderPoint)))
  ) {
    return undefined;
  }
  return {
    familyId,
    packageId: packageId as string | undefined,
    locationId: locationId as string | undefined,
    productId,
    quantity,
    unit: unit as InventoryUnit,
    reorderPoint: reorderPoint as number | undefined,
  };
}

function parseRecordMovementBody(body: Record<string, unknown>):
  | {
      familyId: string;
      kind: MovementKind;
      quantity: number;
      unit: InventoryUnit;
      source: string;
      clientOperationId: string;
      occurredAt: Date;
    }
  | undefined {
  const { familyId, kind, quantity, unit, source, clientOperationId, occurredAt } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    typeof kind !== "string" ||
    !MOVEMENT_KINDS.includes(kind as MovementKind) ||
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    typeof unit !== "string" ||
    !INVENTORY_UNITS.includes(unit as InventoryUnit) ||
    typeof source !== "string" ||
    source.length === 0 ||
    typeof clientOperationId !== "string" ||
    clientOperationId.length === 0 ||
    typeof occurredAt !== "string"
  ) {
    return undefined;
  }
  const occurredAtDate = new Date(occurredAt);
  if (Number.isNaN(occurredAtDate.getTime())) return undefined;
  return {
    familyId,
    kind: kind as MovementKind,
    quantity,
    unit: unit as InventoryUnit,
    source,
    clientOperationId,
    occurredAt: occurredAtDate,
  };
}

const PRODUCT_UNITS: readonly ProductUnit[] = ["g", "kg", "ml", "l", "piece", "pack"];

function parseCreateProductBody(
  body: Record<string, unknown>,
): { canonicalName: string; brand?: string; defaultUnit: ProductUnit } | undefined {
  const { canonicalName, brand, defaultUnit } = body;
  if (
    typeof canonicalName !== "string" ||
    canonicalName.length === 0 ||
    typeof defaultUnit !== "string" ||
    !PRODUCT_UNITS.includes(defaultUnit as ProductUnit) ||
    (brand !== undefined && typeof brand !== "string")
  ) {
    return undefined;
  }
  return { canonicalName, brand: brand as string | undefined, defaultUnit: defaultUnit as ProductUnit };
}

const SHOPPING_SOURCE_TYPES: readonly ShoppingSourceType[] = ["MANUAL", "REORDER", "OFFER", "RECIPE"];

function parseCreateShoppingListBody(
  body: Record<string, unknown>,
): { familyId: string; name: string } | undefined {
  const { familyId, name } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    typeof name !== "string" ||
    name.trim().length === 0
  ) {
    return undefined;
  }
  return { familyId, name };
}

function parseAddShoppingItemBody(body: Record<string, unknown>):
  | {
      familyId: string;
      productId?: string;
      displayName: string;
      quantity: number;
      unit: InventoryUnit;
      packageId?: string;
      sourceType: ShoppingSourceType;
      sourceRef?: string;
    }
  | undefined {
  const { familyId, productId, displayName, quantity, unit, packageId, sourceType, sourceRef } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    typeof displayName !== "string" ||
    displayName.trim().length === 0 ||
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    typeof unit !== "string" ||
    !INVENTORY_UNITS.includes(unit as InventoryUnit) ||
    typeof sourceType !== "string" ||
    !SHOPPING_SOURCE_TYPES.includes(sourceType as ShoppingSourceType) ||
    (productId !== undefined && typeof productId !== "string") ||
    (packageId !== undefined && typeof packageId !== "string") ||
    (sourceRef !== undefined && typeof sourceRef !== "string")
  ) {
    return undefined;
  }
  return {
    familyId,
    productId: productId as string | undefined,
    displayName,
    quantity,
    unit: unit as InventoryUnit,
    packageId: packageId as string | undefined,
    sourceType: sourceType as ShoppingSourceType,
    sourceRef: sourceRef as string | undefined,
  };
}

function buildMeta(request: IncomingMessage): FamilyHttpMeta {
  return {
    requestId: readRequestId(request),
    traceId: readTraceId(request),
    schemaVersion: "1.0",
  };
}

function readRequestId(request: IncomingMessage): string {
  const candidate = request.headers["x-request-id"]?.toString().trim();
  return candidate && candidate.length <= 128 ? candidate : randomUUID();
}

function readTraceId(request: IncomingMessage): string {
  const candidate = request.headers["x-trace-id"]?.toString().trim();
  return candidate && /^[0-9a-f]{16,128}$/i.test(candidate)
    ? candidate
    : randomUUID().replaceAll("-", "");
}

function failure(code: string, message: string, meta: FamilyHttpMeta) {
  return { error: { code, message, retryable: false, details: [] }, meta };
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
