import { randomUUID } from "node:crypto";
import { createApiServer, type ApiServerOptions } from "./http.js";
import { JsonLogSink, RuntimeObservability } from "@gestione-dispensa/observability";
import { PostgresClient, resolveDatabaseUrl } from "./db/postgres-client.js";
import { FamilyService } from "./family/service.js";
import { InviteService } from "./family/invites.js";
import {
  PostgresFamilyRepository,
  PostgresFamilyMembershipReader,
  PostgresInviteRepository,
} from "./family/postgres.js";
import { FamilyController } from "./family/controller.js";
import { InventoryService } from "./inventory/service.js";
import { PostgresInventoryRepository, PostgresInventoryReader } from "./inventory/postgres.js";
import { InventoryController } from "./inventory/controller.js";
import { CatalogService } from "./catalog/service.js";
import { CatalogWorkflowService } from "./catalog/workflow.js";
import {
  PostgresCatalogRepository,
  PostgresCatalogCandidateRepository,
  PostgresCatalogLookupRepository,
} from "./catalog/postgres.js";
import { CatalogController } from "./catalog/controller.js";
import { ShoppingService } from "./shopping/service.js";
import { PostgresShoppingRepository } from "./shopping/postgres.js";
import { ShoppingController } from "./shopping/controller.js";
import { OidcTokenVerifier } from "./identity/oidc.js";

const port = Number(process.env.PORT ?? 3000);
const version = process.env.APP_VERSION ?? "0.1.0-local";

const observability = new RuntimeObservability(
  "api",
  new JsonLogSink({ write: (line) => process.stdout.write(line) }),
);
const startupLog = observability.logger({ requestId: "system", traceId: "startup" });

async function buildServerOptions(): Promise<ApiServerOptions> {
  const options: ApiServerOptions = {
    version,
    profile: process.env.APP_ENV ?? "local",
  };

  let postgres: PostgresClient | undefined;
  try {
    postgres = PostgresClient.create({ connectionString: resolveDatabaseUrl() });
    options.postgres = postgres;
  } catch (error) {
    startupLog.info("postgres_not_configured", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }

  const oidcIssuer = process.env.OIDC_ISSUER;
  const oidcAudience = process.env.OIDC_AUDIENCE;
  if (postgres !== undefined && oidcIssuer && oidcAudience) {
    try {
      const verifier = await OidcTokenVerifier.fromIssuer(oidcIssuer, oidcAudience);
      const families = new FamilyService(new PostgresFamilyRepository(postgres), idGenerator, clock);
      const invites = new InviteService(new PostgresInviteRepository(postgres), idGenerator, clock);
      const memberships = new PostgresFamilyMembershipReader(postgres);
      const controller = new FamilyController(families, invites, memberships);
      options.family = { controller, verifier };

      const inventoryService = new InventoryService(new PostgresInventoryRepository(postgres), idGenerator);
      const inventoryReader = new PostgresInventoryReader(postgres);
      const inventoryController = new InventoryController(inventoryService, memberships, inventoryReader);
      options.inventory = { controller: inventoryController, verifier };

      const catalogService = new CatalogService(new PostgresCatalogRepository(postgres), idGenerator, clock);
      const catalogWorkflow = new CatalogWorkflowService(
        new PostgresCatalogLookupRepository(postgres),
        new PostgresCatalogCandidateRepository(postgres),
      );
      const catalogController = new CatalogController(catalogService, catalogWorkflow);
      options.catalog = { controller: catalogController, verifier };

      const shoppingService = new ShoppingService(new PostgresShoppingRepository(postgres), idGenerator);
      const shoppingController = new ShoppingController(shoppingService, memberships);
      options.shopping = { controller: shoppingController, verifier };
    } catch (error) {
      startupLog.info("oidc_not_configured", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  } else if (postgres !== undefined) {
    startupLog.info("family_routes_disabled", {
      reason:
        "OIDC_ISSUER and OIDC_AUDIENCE must both be set to enable the family/inventory/catalog/shopping HTTP surface",
    });
  }

  return options;
}

const idGenerator = { next: () => randomUUID() };
const clock = { now: () => new Date() };

buildServerOptions()
  .then((options) => {
    const server = createApiServer(options);

    server.listen(port, "0.0.0.0", () => {
      startupLog.info("api_started", {
        port,
        version,
        postgresConfigured: options.postgres !== undefined,
        familyRoutesEnabled: options.family !== undefined,
        inventoryRoutesEnabled: options.inventory !== undefined,
        catalogRoutesEnabled: options.catalog !== undefined,
        shoppingRoutesEnabled: options.shopping !== undefined,
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
