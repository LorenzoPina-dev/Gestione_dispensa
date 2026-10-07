import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "jobs", moduleUrl: import.meta.url });
