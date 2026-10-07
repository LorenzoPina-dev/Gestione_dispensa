import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "notifications", moduleUrl: import.meta.url });
