import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "privacy", moduleUrl: import.meta.url });
