import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "shopping", moduleUrl: import.meta.url });
