import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "inventory", moduleUrl: import.meta.url });
