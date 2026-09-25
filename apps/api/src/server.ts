import { randomUUID } from "node:crypto";
import { buildApp, type ApiServerOptions } from "./http/app.js";           // ← era "./http.js"
import { JsonLogSink, RuntimeObservability } from "@gestione-dispensa/observability";
import { PostgresClient, resolveDatabaseUrl } from "./db/postgres-client.js";
import { FamilyService } from "./family/service.js";
import { InviteService } from "./family/invites.js";
import {
  PostgresFamilyRepository,
  PostgresFamilyMembershipReader,
  PostgresInviteRepository,
  PostgresMembershipRepository,
  PostgresUserFamiliesReader,
} from "./family/postgres.js";
import { MembershipService } from "./family/membership.js";
import { FamilyController } from "./family/controller.js";
import { InventoryService } from "./inventory/service.js";
import { PostgresInventoryRepository, PostgresInventoryReader } from "./inventory/postgres.js";
import { InventoryController } from "./inventory/controller.js";
import { ShelfLifeEstimationService } from "./shelf-life/service.js";
import { PostgresShelfLifeRuleRepository, PostgresExpiryScanRepository } from "./shelf-life/postgres.js";
import { ExpiryScanService } from "./shelf-life/expiry-scan.js";
import { CatalogService } from "./catalog/service.js";
import { CatalogWorkflowService } from "./catalog/workflow.js";
import {
  PostgresCatalogRepository,
  PostgresCatalogCandidateRepository,
  PostgresCatalogLookupRepository,
} from "./catalog/postgres.js";
import { CatalogController } from "./catalog/controller.js";
import { HttpOffLookupClient } from "./catalog/external-barcode-client.js";
import { ShoppingService } from "./shopping/service.js";
import { PostgresShoppingRepository } from "./shopping/postgres.js";
import { ShoppingController } from "./shopping/controller.js";
import { JobAdministrationService } from "./jobs/admin.js";
import {
  PostgresJobAdminRepository,
  PostgresJobReplayPublisher,
  PostgresSecurityAuditWriter,
} from "./jobs/postgres.js";
import { PrivacyErasureService } from "./privacy/erasure.js";
import { PrivacyExportService } from "./privacy/export.js";
import {
  PostgresPrivacyErasureRepository,
  PostgresPrivacyExportRepository,
  PostgresExportArtifactStore,
  PostgresPrivacyAuditWriter,
} from "./privacy/postgres.js";
import { OidcTokenVerifier } from "./identity/oidc.js";
import { PostgresUserProfileRepository } from "./identity/users.js";
import { NotificationService } from "./notifications/service.js";
import { NotificationController } from "./notifications/controller.js";
import { PostgresNotificationRepository } from "./notifications/postgres.js";
import { NutritionService } from "./nutrition/service.js";
import { NutritionController } from "./nutrition/controller.js";
import { PostgresNutritionReader } from "./nutrition/postgres.js";
import { RecipeService } from "./recipes/service.js";
import { RecipeController } from "./recipes/controller.js";
import { PostgresRecipeRepository, PostgresRecipeStockReader } from "./recipes/postgres.js";

const port = Number(process.env.PORT ?? 3000);
const version = process.env.APP_VERSION ?? "0.1.0-local";

const observability = new RuntimeObservability(
  "api",
  new JsonLogSink({ write: (line) => process.stdout.write(line) }),
);
const startupLog = observability.logger({ requestId: "system", traceId: "startup" });

const idGenerator = { next: () => randomUUID() };
const clock = { now: () => new Date() };

async function buildServerOptions(): Promise<ApiServerOptions> {
  const options: ApiServerOptions = {
    version,
    profile: process.env.APP_ENV ?? "local",
  };

  let postgres: PostgresClient | undefined;
  try {
    postgres = PostgresClient.create({ connectionString: resolveDatabaseUrl() });
    options.postgres = postgres;
    options.userProfiles = new PostgresUserProfileRepository(postgres);
  } catch (error) {
    startupLog.info("postgres_not_configured", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }

  const oidcIssuer = process.env.OIDC_ISSUER;
  const oidcAudience = process.env.OIDC_AUDIENCE;
  if (postgres !== undefined && oidcIssuer && oidcAudience) {
    try {
      const oidcOptions: { discoveryUrl?: string; jwksUrl?: string } = {};
      if (process.env.OIDC_DISCOVERY_URL) oidcOptions.discoveryUrl = process.env.OIDC_DISCOVERY_URL;
      if (process.env.OIDC_JWKS_URL) oidcOptions.jwksUrl = process.env.OIDC_JWKS_URL;
      const verifier = await OidcTokenVerifier.fromIssuer(oidcIssuer, oidcAudience, fetch, oidcOptions);
      const families = new FamilyService(new PostgresFamilyRepository(postgres), idGenerator, clock);
      const invites = new InviteService(new PostgresInviteRepository(postgres), idGenerator, clock);
      const memberships = new PostgresFamilyMembershipReader(postgres);
      const membershipService = new MembershipService(new PostgresMembershipRepository(postgres));
      const userFamilies = new PostgresUserFamiliesReader(postgres);
      options.family = {
        controller: new FamilyController(families, invites, memberships, membershipService, userFamilies),
        verifier,
      };

      const shelfLifeEstimator = new ShelfLifeEstimationService(new PostgresShelfLifeRuleRepository(postgres));
      const inventoryService = new InventoryService(
        new PostgresInventoryRepository(postgres, shelfLifeEstimator),
        idGenerator,
      );
      const inventoryReader = new PostgresInventoryReader(postgres);
      options.inventory = {
        controller: new InventoryController(inventoryService, memberships, inventoryReader),
        verifier,
      };

      const catalogService = new CatalogService(new PostgresCatalogRepository(postgres), idGenerator, clock);
      // Optional on purpose: with OFF_LOOKUP_BASE_URL unset (or off-lookup unreachable at request
      // time), resolveBarcode degrades to "UNKNOWN" for unrecognized barcodes instead of failing
      // to start or failing the HTTP request — see CatalogWorkflowService.resolveBarcode.
      const offLookupBaseUrl = process.env.OFF_LOOKUP_BASE_URL;
      const externalBarcodeLookup =
        offLookupBaseUrl !== undefined && offLookupBaseUrl.trim().length > 0
          ? new HttpOffLookupClient({
              baseUrl: offLookupBaseUrl,
              timeoutMs: Number(process.env.OFF_LOOKUP_TIMEOUT_MS ?? 5000),
            })
          : undefined;
      const catalogWorkflow = new CatalogWorkflowService(
        new PostgresCatalogLookupRepository(postgres),
        new PostgresCatalogCandidateRepository(postgres),
        externalBarcodeLookup,
      );
      options.catalog = { controller: new CatalogController(catalogService, catalogWorkflow), verifier };

      const shoppingService = new ShoppingService(new PostgresShoppingRepository(postgres), idGenerator);
      options.shopping = { controller: new ShoppingController(shoppingService, memberships), verifier };

      const notificationService = new NotificationService(
        new PostgresNotificationRepository(postgres),
        idGenerator,
      );
      options.notifications = {
        controller: new NotificationController(notificationService, memberships),
        verifier,
      };

      // EXPIRY_SCAN: periodically warns families about stock lots (manually dated or
      // auto-estimated via shelfLifeEstimator above) approaching their expiry. This is the
      // directly-callable composition of the EXPIRY_SCAN task placeholder declared in
      // services/scheduler/src/scheduler.ts (TASK_TYPES) -- see ExpiryScanService for why a
      // simple interval is used here instead of the full distributed Scheduler.
      const expiryScanIntervalMs = Number(process.env.EXPIRY_SCAN_INTERVAL_MS ?? 21_600_000); // 6h
      if (process.env.EXPIRY_SCAN_ENABLED !== "false" && expiryScanIntervalMs > 0) {
        const expiryScan = new ExpiryScanService(
          new PostgresExpiryScanRepository(postgres),
          shelfLifeEstimator,
          notificationService,
        );
        const expiryScanLog = observability.logger({ requestId: "system", traceId: "expiry-scan" });
        const runExpiryScan = (): void => {
          expiryScan
            .scan()
            .then((result) =>
              expiryScanLog.info("expiry_scan_completed", {
                scanned: result.scanned,
                notified: result.notified,
              }),
            )
            .catch((error: unknown) =>
              expiryScanLog.error("expiry_scan_failed", {
                error: error instanceof Error ? error.message : "unknown",
              }),
            );
        };
        runExpiryScan();
        setInterval(runExpiryScan, expiryScanIntervalMs).unref();
      }

      const nutritionService = new NutritionService(new PostgresNutritionReader(postgres));
      options.nutrition = {
        controller: new NutritionController(nutritionService, memberships),
        verifier,
      };

      const recipeService = new RecipeService(
        new PostgresRecipeRepository(postgres),
        new PostgresRecipeStockReader(postgres),
        shoppingService,
        inventoryService,
      );
      options.recipes = { controller: new RecipeController(recipeService, memberships), verifier };

      const jobAdminService = new JobAdministrationService(
        new PostgresJobAdminRepository(postgres),
        new PostgresJobReplayPublisher(postgres),
        new PostgresSecurityAuditWriter(postgres),
        idGenerator.next,
        () => Date.now(),
      );
      options.jobs = { service: jobAdminService, verifier };

      const privacyAudit = new PostgresPrivacyAuditWriter(postgres);
      const erasureService = new PrivacyErasureService(
        new PostgresPrivacyErasureRepository(postgres),
        memberships,
        { publish: async () => {} },
        privacyAudit,
        () => Date.now(),
      );
      const exportService = new PrivacyExportService(
        new PostgresPrivacyExportRepository(postgres),
        memberships,
        { publish: async () => {} },
        new PostgresExportArtifactStore(postgres),
        privacyAudit,
        () => Date.now(),
      );
      options.privacy = { erasure: erasureService, export: exportService, verifier };
    } catch (error) {
      startupLog.info("oidc_not_configured", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  } else if (postgres !== undefined) {
    startupLog.info("family_routes_disabled", {
      reason:
        "OIDC_ISSUER and OIDC_AUDIENCE must both be set to enable the family/inventory/catalog/shopping/jobs/privacy HTTP surface",
    });
  }

  return options;
}

buildServerOptions()
  .then((options) => {
    // ─── QUI LA DIFFERENZA CHIAVE ─────────────────────────────────
    // buildApp() restituisce un'istanza Express; .listen() restituisce
    // comunque un http.Server, quindi shutdown/close restano identici.
    const app = buildApp(options);
    const server = app.listen(port, "0.0.0.0", () => {
      startupLog.info("api_started", {
        port,
        version,
        postgresConfigured: options.postgres !== undefined,
        familyRoutesEnabled: options.family !== undefined,
        inventoryRoutesEnabled: options.inventory !== undefined,
        catalogRoutesEnabled: options.catalog !== undefined,
        shoppingRoutesEnabled: options.shopping !== undefined,
        notificationsRoutesEnabled: options.notifications !== undefined,
        nutritionRoutesEnabled: options.nutrition !== undefined,
        recipesRoutesEnabled: options.recipes !== undefined,
        jobsRoutesEnabled: options.jobs !== undefined,
        privacyRoutesEnabled: options.privacy !== undefined,
      });
    });

    function shutdown(signal: string): void {
      observability.logger({ requestId: "system", traceId: "shutdown" }).info("api_shutdown", {
        signal,
      });
      server.close((error) => {
        if (error) {
          observability
            .logger({ requestId: "system", traceId: "shutdown" })
            .error("api_shutdown_failed", { error: error.message });
          process.exitCode = 1;
          return;
        }
        process.exitCode = 0;
      });
    }

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  })
  .catch((error: unknown) => {
    startupLog.error("api_startup_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    process.exitCode = 1;
  });
