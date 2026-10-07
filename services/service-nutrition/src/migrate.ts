import { runMigrations } from "@gestione-dispensa/runtime-db";

await runMigrations({ serviceName: "nutrition", moduleUrl: import.meta.url });
