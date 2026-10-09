import { randomUUID } from "node:crypto";
import express from "express";
import { PostgresClient, resolveDatabaseUrl } from "./db/postgres-client.js";
import { OidcTokenVerifier } from "./identity/oidc.js";
import { CatalogService } from "./catalog/service.js";
import { CatalogWorkflowService } from "./catalog/workflow.js";
import {
  PostgresCatalogRepository,
  PostgresCatalogCandidateRepository,
  PostgresCatalogLookupRepository,
} from "./catalog/postgres.js";
import { CatalogController } from "./catalog/controller.js";
import { HttpOffLookupClient } from "./catalog/external-barcode-client.js";
import { buildCatalogRouter } from "./http/routes/catalog.js";
import { corsMiddleware, requestMetaMiddleware } from "./http/middleware.js";
import { buildMeta, sendFailure } from "./http/envelope.js";

const port = Number(process.env.PORT ?? 3314);
const app = express();

app.use(corsMiddleware());
app.use(requestMetaMiddleware());
app.use(express.json({ limit: "2mb" }));

async function bootstrap(): Promise<void> {
  const pg = PostgresClient.create({ connectionString: resolveDatabaseUrl() });

  const repo = new PostgresCatalogRepository(pg);
  const offLookupClient = new HttpOffLookupClient({
    baseUrl: process.env.OFF_LOOKUP_BASE_URL ?? "http://off-lookup:3200",
    timeoutMs: Number(process.env.OFF_LOOKUP_TIMEOUT_MS ?? 2500),
    ...(process.env.OFF_LOOKUP_INTERNAL_TOKEN
      ? { internalToken: process.env.OFF_LOOKUP_INTERNAL_TOKEN }
      : {}),
  });
  const workflow = new CatalogWorkflowService(
    new PostgresCatalogLookupRepository(pg),
    new PostgresCatalogCandidateRepository(pg),
    offLookupClient,
    offLookupClient,
  );
  const service = new CatalogService(repo, { next: randomUUID }, { now: () => new Date() });
  const controller = new CatalogController(service, workflow);

  let oidcReady = false;

  app.get("/health/live", (_q, res) =>
    res.json({ status: "ok", service: "service-catalog" }),
  );

  app.get("/health/ready", async (_q, res) => {
    if (!oidcReady) {
      res.status(503).json({ status: "not_ready", dependency: "oidc" });
      return;
    }

    try {
      await pg.ping();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "not_ready", dependency: "postgres" });
    }
  });

  // Start serving liveness immediately. OIDC discovery is an external bootstrap
  // dependency and must not prevent the process from exposing its health endpoint.
  const server = app.listen(port, "0.0.0.0", () =>
    console.log(JSON.stringify({ service: "service-catalog", port, event: "http_listening" })),
  );

  for (;;) {
    try {
      const verifier = await OidcTokenVerifier.fromIssuer(
        process.env.OIDC_ISSUER!,
        process.env.OIDC_AUDIENCE!,
        fetch,
        {
          ...(process.env.OIDC_DISCOVERY_URL
            ? { discoveryUrl: process.env.OIDC_DISCOVERY_URL }
            : {}),
          ...(process.env.OIDC_JWKS_URL ? { jwksUrl: process.env.OIDC_JWKS_URL } : {}),
          discoveryAttempts: 1,
          discoveryTimeoutMs: Number(process.env.OIDC_DISCOVERY_TIMEOUT_MS ?? 5_000),
        },
      );

      app.use("/api/v1", buildCatalogRouter({ controller, verifier }));
      app.use((req, res) =>
        sendFailure(
          res,
          404,
          "NOT_FOUND_OR_NOT_VISIBLE",
          "The resource is not available.",
          req.meta ?? buildMeta(req),
        ),
      );
      oidcReady = true;
      console.log(JSON.stringify({ service: "service-catalog", event: "oidc_ready" }));
      break;
    } catch (error) {
      oidcReady = false;
      console.error(
        JSON.stringify({
          service: "service-catalog",
          event: "oidc_bootstrap_retry",
          error: error instanceof Error ? error.message : String(error),
          retryMs: 2_000,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

void bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

