import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "family", moduleUrl: import.meta.url });
