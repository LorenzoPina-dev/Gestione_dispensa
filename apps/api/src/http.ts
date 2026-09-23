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
import type { ShoppingItemState, ShoppingSourceType } from "./shopping/service.js";
import { NotificationController, toNotificationHttpError } from "./notifications/controller.js";
import { NutritionController, toNutritionHttpError } from "./nutrition/controller.js";
import { RecipeController, toRecipeHttpError } from "./recipes/controller.js";
import { JobAdministrationService, JobAdminError } from "./jobs/admin.js";
import {
  registerUser,
  parseRegisterUserInput,
  resolveKeycloakAdminConfig,
  RegistrationError,
} from "./identity/register.js";

import {
  PrivacyErasureError,
  PrivacyErasureService,
} from "./privacy/erasure.js";
import { PrivacyExportError, PrivacyExportService } from "./privacy/export.js";
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

export interface NotificationRouteDependencies {
  controller: NotificationController;
  verifier: OidcTokenVerifier;
}

export interface NutritionRouteDependencies {
  controller: NutritionController;
  verifier: OidcTokenVerifier;
}

export interface RecipeRouteDependencies {
  controller: RecipeController;
  verifier: OidcTokenVerifier;
}

export interface JobAdminRouteDependencies {
  service: JobAdministrationService;
  verifier: OidcTokenVerifier;
}

export interface PrivacyRouteDependencies {
  erasure: PrivacyErasureService;
  export: PrivacyExportService;
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
  /** When provided, wires `GET /api/v1/notifications` and `POST .../read`. */
  notifications?: NotificationRouteDependencies;
  /** When provided, wires `GET /api/v1/nutrition/summary`. */
  nutrition?: NutritionRouteDependencies;
  /**
   * When provided, wires the recipe suggestion/add-missing/cook HTTP surface. Depends on the
   * shopping and inventory domains internally (RecipeService composes ShoppingService and
   * InventoryService), so it only makes sense to enable alongside those.
   */
  recipes?: RecipeRouteDependencies;
  /**
   * When provided, wires operator-only job administration routes (inspect a
   * job, replay a dead letter). Gated on the "operator" authorization action,
   * not family membership.
   */
  jobs?: JobAdminRouteDependencies;
  /**
   * When provided, wires the privacy HTTP surface: erasure requests, consent
   * management, and data export/download. Erasure and export are family-
   * owner-only; consent is per-user.
   */
  privacy?: PrivacyRouteDependencies;
}

const FAMILY_ITEM_PATTERN = /^\/api\/v1\/families\/([^/]+)$/;
const FAMILY_MEMBERS_PATTERN = /^\/api\/v1\/families\/([^/]+)\/members$/;
const FAMILY_MEMBER_ITEM_PATTERN = /^\/api\/v1\/families\/([^/]+)\/members\/([^/]+)$/;
const FAMILY_INVITES_PATTERN = /^\/api\/v1\/families\/([^/]+)\/invites$/;
const FAMILY_INVITE_ITEM_PATTERN = /^\/api\/v1\/families\/([^/]+)\/invites\/([^/]+)\/revoke$/;
const INVITE_REVIEW_PATTERN = /^\/api\/v1\/family-invites\/([^/]+)\/review$/;
const INVITE_REJECT_PATTERN = /^\/api\/v1\/family-invites\/([^/]+)\/reject$/;
const SHOPPING_LIST_PATTERN = /^\/api\/v1\/shopping-lists\/([^/]+)$/;
const SHOPPING_ARCHIVE_PATTERN = /^\/api\/v1\/shopping-lists\/([^/]+)\/archive$/;
const INVITE_ACCEPT_PATTERN = /^\/api\/v1\/invites\/([^/]+)\/accept$/;
const STOCK_ITEM_PATTERN = /^\/api\/v1\/inventory\/(?:items|stock-items)\/([^/]+)$/;
const STOCK_MOVEMENT_PATTERN = /^\/api\/v1\/inventory\/(?:items|stock-items)\/([^/]+)\/movements$/;
const SHOPPING_LIST_ITEMS_PATTERN = /^\/api\/v1\/(?:shopping-lists|shopping\/lists)\/([^/]+)\/items$/;
const SHOPPING_LIST_ITEM_PATTERN = /^\/api\/v1\/(?:shopping-lists|shopping\/lists)\/([^/]+)\/items\/([^/]+)$/;
const SHOPPING_BATCH_ACTION_PATTERN = /^\/api\/v1\/(?:shopping-lists|shopping\/lists)\/([^/]+)\/batch-action$/;
const NOTIFICATION_READ_PATTERN = /^\/api\/v1\/notifications\/([^/]+)\/read$/;
const RECIPE_ADD_MISSING_PATTERN = /^\/api\/v1\/recipes\/([^/]+)\/add-missing$/;
const RECIPE_COOK_PATTERN = /^\/api\/v1\/recipes\/([^/]+)\/cook$/;
const JOB_ADMIN_PATTERN = /^\/api\/v1\/admin\/jobs\/([^/]+)$/;
const DEAD_LETTER_REPLAY_PATTERN = /^\/api\/v1\/admin\/dead-letters\/([^/]+)\/replay$/;
const PRIVACY_EXPORT_DOWNLOAD_PATTERN = /^\/api\/v1\/privacy\/export\/([^/]+)$/;
const MAX_BODY_BYTES = 1_000_000;

/**
 * Every call site passes a capture group from a regex whose match already succeeded (the
 * enclosing `if (match !== null)` guarantees it). `noUncheckedIndexedAccess` still types
 * `match[n]` as `string | undefined` because TypeScript can't see that guarantee from the regex
 * pattern alone; this narrows it with an explicit, documented check instead of an unsafe `!`/`as`.
 */
function requireCapture(value: string | undefined, context: string): string {
  if (value === undefined) {
    throw new Error(`Route pattern matched but capture group is missing (${context}).`);
  }
  return value;
}

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

  const origin = request.headers.origin;
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    response.setHeader("Access-Control-Allow-Origin", "*");
  }

  response.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, If-Match, Idempotency-Key, x-request-id, x-trace-id",
  );

  // Gestione delle richieste preliminari di verifica (Preflight OPTIONS)
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  // =======================================================

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

  if (path === "/api/v1/me" || path === "/api/v1/auth/me") {
    return requireGet(method, response, meta, async () => {
      const verifier =
        options.family?.verifier ??
        options.inventory?.verifier ??
        options.catalog?.verifier ??
        options.shopping?.verifier ??
        options.notifications?.verifier ??
        options.nutrition?.verifier ??
        options.recipes?.verifier ??
        options.jobs?.verifier ??
        options.privacy?.verifier;
      if (verifier === undefined) {
        writeJson(response, 503, failure("CAPABILITY_UNAVAILABLE", "Identity verification is not configured.", meta));
        return;
      }
      const principal = await resolvePrincipal(request, verifier);
      if (principal === undefined) {
        writeJson(response, 401, failure("UNAUTHENTICATED", "Authentication is required.", meta));
        return;
      }
      const data: Record<string, unknown> = {
        id: principal.subject,
        subject: principal.subject,
        issuer: principal.issuer,
        roles: principal.roles,
        scopes: principal.scopes,
        expiresAt: principal.expiresAt.toISOString(),
      };
      if (principal.issuedAt !== undefined) data.issuedAt = principal.issuedAt.toISOString();
      writeJson(response, 200, { data, meta });
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

  if (path === "/api/v1/auth/register") {
    return requirePost(method, response, meta, async () => {
      const body = await readJsonBody(request, response, meta);
      if (body === undefined) return;
      const parsed = parseRegisterUserInput(body);
      if (parsed === undefined) {
        writeJson(
          response,
          400,
          failure(
            "VALIDATION_ERROR",
            "Nome, email valida e password di almeno 8 caratteri sono obbligatori.",
            meta,
          ),
        );
        return;
      }
      try {
        const result = await registerUser(parsed, resolveKeycloakAdminConfig());
        writeJson(response, 201, { data: result, meta });
      } catch (error) {
        const { status, body: errorBody } = toRegistrationHttpError(error, meta);
        writeJson(response, status, errorBody);
      }
    });
  }

  if (path === "/api/v1/auth/logout") {
    // Stateless JWT bearer auth: the server holds no session to invalidate (no opaque session
    // id, and the client never receives a refresh token this endpoint could revoke). Logging
    // out is the client's responsibility (discard the stored token); this endpoint just gives
    // the client a well-formed response to call on the way out, and always succeeds so a
    // stale/expired token never blocks the user from "logging out".
    return requirePost(method, response, meta, () => {
      response.writeHead(204);
      response.end();
    });
  }

  if (options.family !== undefined) {
    const family = options.family;

    if (path === "/api/v1/families") {
      if (method === "GET") {
        return requireGet(method, response, meta, async () => {
          const principal = await resolvePrincipal(request, family.verifier);
          await respond(
            response,
            meta,
            family.controller.listFamilies(principal, meta),
            toFamilyHttpError,
          );
        });
      }
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

    const familyItemMatch = FAMILY_ITEM_PATTERN.exec(path);
    if (familyItemMatch !== null) {
      return requireGet(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, family.verifier);
        const familyId = requireCapture(familyItemMatch[1], "family id");
        await respond(response, meta, family.controller.getFamily(principal, familyId, meta), toFamilyHttpError);
      });
    }

    const membersMatch = FAMILY_MEMBERS_PATTERN.exec(path);
    if (membersMatch !== undefined && membersMatch !== null) {
      return requireGet(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, family.verifier);
        const familyId = requireCapture(membersMatch[1], "family id");
        await respond(
          response,
          meta,
          family.controller.listMembers(principal, familyId, meta),
          toFamilyHttpError,
        );
      });
    }

    const memberItemMatch = FAMILY_MEMBER_ITEM_PATTERN.exec(path);
    if (memberItemMatch !== undefined && memberItemMatch !== null) {
      const memberFamilyId = requireCapture(memberItemMatch[1], "family id");
      const membershipId = requireCapture(memberItemMatch[2], "membership id");
      if (method === "PATCH") {
        const principal = await resolvePrincipal(request, family.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseUpdateMembershipBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          family.controller.updateMembership(principal, memberFamilyId, membershipId, parsed, meta),
          toFamilyHttpError,
        );
        return;
      }
      if (method === "DELETE") {
        const principal = await resolvePrincipal(request, family.verifier);
        await respond(
          response,
          meta,
          family.controller.removeMembership(principal, memberFamilyId, membershipId, meta),
          toFamilyHttpError,
        );
        return;
      }
      writeJson(response, 405, failure("METHOD_NOT_ALLOWED", "The HTTP method is not allowed.", meta));
      return;
    }

    const inviteRevokeMatch = FAMILY_INVITE_ITEM_PATTERN.exec(path);
    if (inviteRevokeMatch !== undefined && inviteRevokeMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, family.verifier);
        const familyId = requireCapture(inviteRevokeMatch[1], "family id");
        const inviteId = requireCapture(inviteRevokeMatch[2], "invite id");
        await respond(response, meta, family.controller.revokeInvite(principal, familyId, inviteId, meta), toFamilyHttpError);
      });
    }

    const invitesMatch = FAMILY_INVITES_PATTERN.exec(path);
    if (invitesMatch !== undefined && invitesMatch !== null) {
      const invitesFamilyId = requireCapture(invitesMatch[1], "family id");
      if (method === "GET") {
        const principal = await resolvePrincipal(request, family.verifier);
        await respond(response, meta, family.controller.listInvites(principal, invitesFamilyId, meta), toFamilyHttpError);
        return;
      }
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
          family.controller.createInvite(principal, invitesFamilyId, parsed, meta),
          toFamilyHttpError,
        );
      });
    }

    if (path === "/api/v1/invites/resolve" || path === "/api/v1/family-invites/resolve") {
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

    if (path === "/api/v1/invites/resolve-code" || path === "/api/v1/family-invites/resolve-code") {
      return requirePost(method, response, meta, async () => {
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseResolveInviteByCodeBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          family.controller.resolveInviteByCode(
            parsed.code,
            parsed.browserBindingHash,
            meta.traceId,
            meta,
          ),
          toFamilyHttpError,
        );
      });
    }

    const reviewMatch = INVITE_REVIEW_PATTERN.exec(path);
    if (reviewMatch !== undefined && reviewMatch !== null) {
      return requireGet(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, family.verifier);
        const attemptId = requireCapture(reviewMatch[1], "invite attempt id");
        await respond(response, meta, family.controller.reviewInvite(principal, attemptId, meta), toFamilyHttpError);
      });
    }
    const rejectMatch = INVITE_REJECT_PATTERN.exec(path);
    if (rejectMatch !== undefined && rejectMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, family.verifier);
        const attemptId = requireCapture(rejectMatch[1], "invite attempt id");
        await respond(response, meta, family.controller.rejectInvite(principal, attemptId, meta), toFamilyHttpError);
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
        const attemptId = requireCapture(acceptMatch[1], "invite attempt id");
        await respond(
          response,
          meta,
          family.controller.acceptInvite(principal, attemptId, parsed.consentVersion, meta),
          toFamilyHttpError,
        );
      });
    }
  }

  if (options.inventory !== undefined) {
    const inventory = options.inventory;

    if (path === "/api/v1/inventory/items" || path === "/api/v1/inventory/stock-items") {
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

    const stockItemMatch = STOCK_ITEM_PATTERN.exec(path);
    if (stockItemMatch !== null) {
      if (method === "GET") {
        return requireGet(method, response, meta, async () => {
          const principal = await resolvePrincipal(request, inventory.verifier);
          const stockItemId = requireCapture(stockItemMatch[1], "stock item id");
          await respond(response, meta, inventory.controller.getStockItem(principal, stockItemId, meta), toInventoryHttpError);
        });
      }
      writeJson(response, 405, failure("METHOD_NOT_ALLOWED", "The HTTP method is not allowed.", meta)); return;
    }

    const movementMatch = STOCK_MOVEMENT_PATTERN.exec(path);
    if (movementMatch !== undefined && movementMatch !== null) {
      if (method === "GET") {
        return requireGet(method, response, meta, async () => {
          const principal = await resolvePrincipal(request, inventory.verifier);
          const stockItemId = requireCapture(movementMatch[1], "stock item id");
          await respond(response, meta, inventory.controller.listMovements(principal, stockItemId, meta), toInventoryHttpError);
        });
      }
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
        const stockItemId = requireCapture(movementMatch[1], "stock item id");
        await respond(
          response,
          meta,
          inventory.controller.recordMovement(
            principal,
            { ...parsed, stockItemId, traceId: meta.traceId },
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

    if (path === "/api/v1/products" || path === "/api/v1/catalog/products") {
      if (method === "GET") {
        return requireGet(method, response, meta, async () => {
          await respond(response, meta, catalog.controller.listProducts(meta), toCatalogHttpError);
        });
      }
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

    const productItemMatch = /^\/api\/v1\/products\/([^/]+)$/.exec(path);
    if (productItemMatch !== null) {
      return requireGet(method, response, meta, async () => {
        const productId = requireCapture(productItemMatch[1], "product id");
        await respond(response, meta, catalog.controller.getProduct(productId, meta), toCatalogHttpError);
      });
    }

    if (path === "/api/v1/products/resolve-barcode") {
      return requirePost(method, response, meta, async () => {
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const identifierType = typeof body.identifierType === "string" ? body.identifierType : "";
        const value = typeof body.value === "string" ? body.value : "";
        const validTypes: readonly IdentifierType[] = ["EAN8", "EAN13", "GTIN12", "GTIN14", "SKU", "BARCODE"];
        if (!validTypes.includes(identifierType as IdentifierType) || value.trim().length === 0) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "identifierType and value are required.", meta));
          return;
        }
        await respond(response, meta, catalog.controller.lookupBarcode(identifierType as IdentifierType, value, meta), toCatalogHttpError);
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

    if (path === "/api/v1/shopping-lists/active" || path === "/api/v1/shopping/lists/active") {
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

    if (path === "/api/v1/shopping-lists" || path === "/api/v1/shopping/lists") {
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

    const archiveMatch = SHOPPING_ARCHIVE_PATTERN.exec(path);
    if (archiveMatch !== undefined && archiveMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, shopping.verifier);
        const ifMatch = request.headers["if-match"];
        const expectedVersion = typeof ifMatch === "string" ? Number(ifMatch.trim()) : NaN;
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) { writeJson(response, 428, failure("PRECONDITION_REQUIRED", "An If-Match header with the current version is required.", meta)); return; }
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const familyId = typeof body.familyId === "string" ? body.familyId : "";
        if (!familyId) { writeJson(response, 400, failure("VALIDATION_ERROR", "familyId is required.", meta)); return; }
        const listId = requireCapture(archiveMatch[1], "shopping list id");
        await respond(response, meta, shopping.controller.archiveList(principal, familyId, listId, expectedVersion, meta), toShoppingHttpError);
      });
    }

    const listMatch = SHOPPING_LIST_PATTERN.exec(path);
    if (listMatch !== undefined && listMatch !== null) {
      return requireGet(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, shopping.verifier);
        const familyId = url.searchParams.get("familyId");
        if (!familyId) { writeJson(response, 400, failure("VALIDATION_ERROR", "Query parameter familyId is required.", meta)); return; }
        const listId = requireCapture(listMatch[1], "shopping list id");
        await respond(response, meta, shopping.controller.getList(principal, familyId, listId, meta), toShoppingHttpError);
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
        const listId = requireCapture(itemsMatch[1], "shopping list id");
        await respond(
          response,
          meta,
          shopping.controller.addItem(
            principal,
            { ...parsed, listId, traceId: meta.traceId },
            meta,
          ),
          toShoppingHttpError,
        );
      });
    }

    const itemMatch = SHOPPING_LIST_ITEM_PATTERN.exec(path);
    if (itemMatch !== undefined && itemMatch !== null) {
      return requirePatch(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, shopping.verifier);
        const ifMatch = request.headers["if-match"];
        const expectedVersion = typeof ifMatch === "string" ? Number(ifMatch.trim()) : NaN;
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          writeJson(
            response,
            428,
            failure("PRECONDITION_REQUIRED", "An If-Match header with the current version is required.", meta),
          );
          return;
        }
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseUpdateShoppingItemBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        const listId = requireCapture(itemMatch[1], "shopping list id");
        const itemId = requireCapture(itemMatch[2], "shopping item id");
        await respond(
          response,
          meta,
          shopping.controller.updateItemState(
            principal,
            parsed.familyId,
            listId,
            itemId,
            expectedVersion,
            parsed.state,
            meta,
          ),
          toShoppingHttpError,
        );
      });
    }

    const batchMatch = SHOPPING_BATCH_ACTION_PATTERN.exec(path);
    if (batchMatch !== undefined && batchMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, shopping.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseBatchActionBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        const listId = requireCapture(batchMatch[1], "shopping list id");
        await respond(
          response,
          meta,
          shopping.controller.batchUpdateItemState(
            principal,
            parsed.familyId,
            listId,
            parsed.itemIds,
            parsed.state,
            meta,
          ),
          toShoppingHttpError,
        );
      });
    }
  }

  if (options.notifications !== undefined) {
    const notifications = options.notifications;

    if (path === "/api/v1/notifications") {
      return requireGet(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, notifications.verifier);
        const familyId = url.searchParams.get("familyId");
        if (familyId === null || familyId.trim().length === 0) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "Query parameter familyId is required.", meta));
          return;
        }
        await respond(
          response,
          meta,
          notifications.controller.list(principal, familyId, meta),
          toNotificationHttpError,
        );
      });
    }

    const notificationReadMatch = NOTIFICATION_READ_PATTERN.exec(path);
    if (notificationReadMatch !== undefined && notificationReadMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, notifications.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const familyId = typeof body.familyId === "string" ? body.familyId : "";
        if (familyId.length === 0) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "familyId is required.", meta));
          return;
        }
        const notificationId = requireCapture(notificationReadMatch[1], "notification id");
        await respond(
          response,
          meta,
          notifications.controller.markRead(principal, familyId, notificationId, meta),
          toNotificationHttpError,
        );
      });
    }
  }

  if (options.nutrition !== undefined) {
    const nutrition = options.nutrition;

    if (path === "/api/v1/nutrition/summary") {
      return requireGet(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, nutrition.verifier);
        const familyId = url.searchParams.get("familyId");
        const periodParam = url.searchParams.get("period");
        const period = periodParam === "week" ? "week" : "today";
        if (familyId === null || familyId.trim().length === 0) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "Query parameter familyId is required.", meta));
          return;
        }
        await respond(
          response,
          meta,
          nutrition.controller.getSummary(principal, familyId, period, meta),
          toNutritionHttpError,
        );
      });
    }
  }

  if (options.recipes !== undefined) {
    const recipes = options.recipes;

    if (path === "/api/v1/recipes/suggestions") {
      return requireGet(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, recipes.verifier);
        const familyId = url.searchParams.get("familyId");
        if (familyId === null || familyId.trim().length === 0) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "Query parameter familyId is required.", meta));
          return;
        }
        await respond(
          response,
          meta,
          recipes.controller.listSuggestions(principal, familyId, meta),
          toRecipeHttpError,
        );
      });
    }

    const addMissingMatch = RECIPE_ADD_MISSING_PATTERN.exec(path);
    if (addMissingMatch !== undefined && addMissingMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, recipes.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const familyId = typeof body.familyId === "string" ? body.familyId : "";
        if (familyId.length === 0) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "familyId is required.", meta));
          return;
        }
        const recipeId = requireCapture(addMissingMatch[1], "recipe id");
        await respond(
          response,
          meta,
          recipes.controller.addMissingIngredients(principal, familyId, recipeId, meta.traceId, meta),
          toRecipeHttpError,
        );
      });
    }

    const cookMatch = RECIPE_COOK_PATTERN.exec(path);
    if (cookMatch !== undefined && cookMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, recipes.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const familyId = typeof body.familyId === "string" ? body.familyId : "";
        const servings = typeof body.servings === "number" ? body.servings : NaN;
        if (familyId.length === 0 || !Number.isFinite(servings) || servings <= 0) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "familyId and a positive servings are required.", meta));
          return;
        }
        const recipeId = requireCapture(cookMatch[1], "recipe id");
        await respond(
          response,
          meta,
          recipes.controller.cook(principal, familyId, recipeId, servings, meta.traceId, meta),
          toRecipeHttpError,
        );
      });
    }
  }

  if (options.jobs !== undefined) {
    const jobs = options.jobs;

    const jobMatch = JOB_ADMIN_PATTERN.exec(path);
    if (jobMatch !== undefined && jobMatch !== null) {
      return requireGet(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, jobs.verifier);
        const jobId = requireCapture(jobMatch[1], "job id");
        await respond(
          response,
          meta,
          jobs.service.inspect(principal, jobId, meta.traceId).then((data) => ({ data, meta })),
          toJobAdminHttpError,
        );
      });
    }

    const replayMatch = DEAD_LETTER_REPLAY_PATTERN.exec(path);
    if (replayMatch !== undefined && replayMatch !== null) {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, jobs.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseReplayBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        const deadLetterId = requireCapture(replayMatch[1], "dead letter id");
        await respond(
          response,
          meta,
          jobs.service
            .replay(principal, deadLetterId, { ...parsed, traceId: meta.traceId })
            .then((data) => ({ data, meta })),
          toJobAdminHttpError,
        );
      });
    }
  }

  if (options.privacy !== undefined) {
    const privacy = options.privacy;

    if (path === "/api/v1/privacy/erasure") {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, privacy.verifier);
        const idempotencyKey = request.headers["idempotency-key"];
        if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
          writeJson(
            response,
            400,
            failure("VALIDATION_ERROR", "An Idempotency-Key header is required.", meta),
          );
          return;
        }
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseErasureRequestBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          privacy.erasure
            .request(principal, parsed.familyId, parsed.confirmed, idempotencyKey, meta.traceId)
            .then((data) => ({ data, meta })),
          toPrivacyErasureHttpError,
        );
      });
    }

    if (path === "/api/v1/privacy/consents" || path === "/api/v1/privacy/consent") {
      if (method === "GET") {
        return requireGet(method, response, meta, async () => {
          const principal = await resolvePrincipal(request, privacy.verifier);
          await respond(
            response,
            meta,
            privacy.erasure.listConsents(principal).then((data) => ({ data, meta })),
            toPrivacyErasureHttpError,
          );
        });
      }
      if (method === "PUT") {
        const principal = await resolvePrincipal(request, privacy.verifier);
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseConsentBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          privacy.erasure
            .updateConsent(principal, parsed.purpose, parsed.granted, parsed.consentVersion, meta.traceId)
            .then((data) => ({ data, meta })),
          toPrivacyErasureHttpError,
        );
        return;
      }
      writeJson(response, 405, failure("METHOD_NOT_ALLOWED", "The HTTP method is not allowed.", meta));
      return;
    }

    if (path === "/api/v1/privacy/export") {
      return requirePost(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, privacy.verifier);
        const idempotencyKey = request.headers["idempotency-key"];
        if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
          writeJson(
            response,
            400,
            failure("VALIDATION_ERROR", "An Idempotency-Key header is required.", meta),
          );
          return;
        }
        const body = await readJsonBody(request, response, meta);
        if (body === undefined) return;
        const parsed = parseExportRequestBody(body);
        if (parsed === undefined) {
          writeJson(response, 400, failure("VALIDATION_ERROR", "The request body is invalid.", meta));
          return;
        }
        await respond(
          response,
          meta,
          privacy.export
            .create(principal, parsed.familyId, idempotencyKey, meta.traceId)
            .then((data) => ({ data, meta })),
          toPrivacyExportHttpError,
        );
      });
    }

    const exportDownloadMatch = PRIVACY_EXPORT_DOWNLOAD_PATTERN.exec(path);
    if (exportDownloadMatch !== undefined && exportDownloadMatch !== null) {
      return requireGet(method, response, meta, async () => {
        const principal = await resolvePrincipal(request, privacy.verifier);
        const exportId = requireCapture(exportDownloadMatch[1], "export id");
        await respond(
          response,
          meta,
          privacy.export
            .download(principal, exportId, meta.traceId)
            .then((data) => ({ data, meta })),
          toPrivacyExportHttpError,
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

function requirePatch(
  method: string,
  response: ServerResponse,
  meta: FamilyHttpMeta,
  handler: () => void | Promise<void>,
): void | Promise<void> {
  if (method !== "PATCH") {
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

function parseResolveInviteByCodeBody(body: Record<string, unknown>) {
  const { code, browserBindingHash } = body;
  if (typeof code !== "string" || !/^\d{6}$/.test(code.replace(/[^0-9]/g, ""))) return undefined;
  if (typeof browserBindingHash !== "string" || !/^[0-9a-f]{16,128}$/i.test(browserBindingHash)) {
    return undefined;
  }
  return { code: code.replace(/[^0-9]/g, ""), browserBindingHash };
}

function parseAcceptInviteBody(body: Record<string, unknown>) {
  const { consentVersion } = body;
  if (typeof consentVersion !== "string" || consentVersion.trim().length === 0) return undefined;
  return { consentVersion };
}

function parseUpdateMembershipBody(
  body: Record<string, unknown>,
): { role: string; status: string } | undefined {
  const { role, status } = body;
  const roles = ["ADMIN", "MANAGER", "MEMBER", "VIEWER"];
  const statuses = ["ACTIVE", "SUSPENDED"];
  if (
    typeof role !== "string" ||
    !roles.includes(role) ||
    typeof status !== "string" ||
    !statuses.includes(status)
  ) {
    return undefined;
  }
  return { role, status };
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
    productId,
    ...(packageId !== undefined ? { packageId: packageId as string } : {}),
    ...(locationId !== undefined ? { locationId: locationId as string } : {}),
    quantity,
    unit: unit as InventoryUnit,
    ...(reorderPoint !== undefined ? { reorderPoint: reorderPoint as number } : {}),
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
  return {
    canonicalName,
    ...(brand !== undefined ? { brand: brand as string } : {}),
    defaultUnit: defaultUnit as ProductUnit,
  };
}

const SHOPPING_SOURCE_TYPES: readonly ShoppingSourceType[] = ["MANUAL", "REORDER", "OFFER", "RECIPE"];
const SHOPPING_ITEM_STATES: readonly ShoppingItemState[] = [
  "SUGGESTED",
  "ACCEPTED",
  "SNOOZED",
  "IGNORED",
  "COMPLETED",
];

function parseUpdateShoppingItemBody(
  body: Record<string, unknown>,
): { familyId: string; state: ShoppingItemState } | undefined {
  const { familyId, state } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    typeof state !== "string" ||
    !SHOPPING_ITEM_STATES.includes(state as ShoppingItemState)
  ) {
    return undefined;
  }
  return { familyId, state: state as ShoppingItemState };
}

function parseBatchActionBody(
  body: Record<string, unknown>,
): { familyId: string; itemIds: string[]; state: ShoppingItemState } | undefined {
  const { familyId, itemIds, state } = body;
  if (
    typeof familyId !== "string" ||
    familyId.length === 0 ||
    !Array.isArray(itemIds) ||
    itemIds.length === 0 ||
    !itemIds.every((id) => typeof id === "string" && id.length > 0) ||
    typeof state !== "string" ||
    !SHOPPING_ITEM_STATES.includes(state as ShoppingItemState)
  ) {
    return undefined;
  }
  return { familyId, itemIds: itemIds as string[], state: state as ShoppingItemState };
}

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
    ...(productId !== undefined ? { productId: productId as string } : {}),
    displayName,
    quantity,
    unit: unit as InventoryUnit,
    ...(packageId !== undefined ? { packageId: packageId as string } : {}),
    sourceType: sourceType as ShoppingSourceType,
    ...(sourceRef !== undefined ? { sourceRef: sourceRef as string } : {}),
  };
}

function parseReplayBody(
  body: Record<string, unknown>,
): { reason: string; approvalId: string } | undefined {
  const { reason, approvalId } = body;
  if (
    typeof reason !== "string" ||
    reason.trim().length === 0 ||
    typeof approvalId !== "string" ||
    approvalId.trim().length === 0
  ) {
    return undefined;
  }
  return { reason, approvalId };
}

function parseErasureRequestBody(
  body: Record<string, unknown>,
): { familyId: string; confirmed: boolean } | undefined {
  const { familyId, confirmed } = body;
  if (typeof familyId !== "string" || familyId.length === 0 || typeof confirmed !== "boolean") {
    return undefined;
  }
  return { familyId, confirmed };
}

function parseConsentBody(
  body: Record<string, unknown>,
): { purpose: string; granted: boolean; consentVersion: string } | undefined {
  const { purpose, granted, consentVersion } = body;
  if (
    typeof purpose !== "string" ||
    purpose.trim().length === 0 ||
    typeof granted !== "boolean" ||
    typeof consentVersion !== "string" ||
    consentVersion.trim().length === 0
  ) {
    return undefined;
  }
  return { purpose, granted, consentVersion };
}

function parseExportRequestBody(body: Record<string, unknown>): { familyId: string } | undefined {
  const { familyId } = body;
  if (typeof familyId !== "string" || familyId.length === 0) return undefined;
  return { familyId };
}

function toRegistrationHttpError(
  error: unknown,
  meta: FamilyHttpMeta,
): { status: number; body: { error: { code: string; message: string; retryable: boolean }; meta: FamilyHttpMeta } } {
  if (error instanceof RegistrationError) {
    const status =
      error.code === "USER_ALREADY_EXISTS"
        ? 409
        : error.code === "AUTH_SERVICE_UNAVAILABLE"
          ? 503
          : 400;
    return {
      status,
      body: {
        error: { code: error.code, message: error.message, retryable: error.code === "AUTH_SERVICE_UNAVAILABLE" },
        meta,
      },
    };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false }, meta },
  };
}

function toJobAdminHttpError(
  error: unknown,
  meta: FamilyHttpMeta,
): { status: number; body: { error: { code: string; message: string; retryable: boolean }; meta: FamilyHttpMeta } } {
  if (error instanceof JobAdminError) {
    const status =
      error.code === "UNAUTHENTICATED"
        ? 401
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND_OR_NOT_VISIBLE"
            ? 404
            : error.code === "APPROVAL_REQUIRED"
              ? 422
              : 500;
    return { status, body: { error: { code: error.code, message: error.message, retryable: false }, meta } };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false }, meta },
  };
}

function toPrivacyErasureHttpError(
  error: unknown,
  meta: FamilyHttpMeta,
): { status: number; body: { error: { code: string; message: string; retryable: boolean }; meta: FamilyHttpMeta } } {
  if (error instanceof PrivacyErasureError) {
    const status =
      error.code === "UNAUTHENTICATED"
        ? 401
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND_OR_NOT_VISIBLE"
            ? 404
            : error.code === "CONFIRMATION_REQUIRED" || error.code === "INVALID_CONSENT"
              ? 422
              : 500;
    return { status, body: { error: { code: error.code, message: error.message, retryable: false }, meta } };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false }, meta },
  };
}

function toPrivacyExportHttpError(
  error: unknown,
  meta: FamilyHttpMeta,
): { status: number; body: { error: { code: string; message: string; retryable: boolean }; meta: FamilyHttpMeta } } {
  if (error instanceof PrivacyExportError) {
    const status =
      error.code === "UNAUTHENTICATED"
        ? 401
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND_OR_NOT_VISIBLE"
            ? 404
            : error.code === "EXPORT_EXPIRED"
              ? 410
              : 500;
    return { status, body: { error: { code: error.code, message: error.message, retryable: false }, meta } };
  }
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false }, meta },
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
