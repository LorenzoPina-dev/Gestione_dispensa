// apps/web/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";

const CERTS_DIR = path.resolve(__dirname, "../../certs");
const KEY_PATH = path.join(CERTS_DIR, "local-key.pem");
const CERT_PATH = path.join(CERTS_DIR, "local.pem");

const httpsConfig =
  fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)
    ? { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) }
    : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    host: true,
    ...(httpsConfig ? { https: httpsConfig } : {}),
    // Vite ora è dietro nginx: HMR deve sapere di quale host fidarsi.
    // Senza `allowedHosts`, Vite blocca le richieste con Host diverso da
    // localhost (protezione anti-DNS-rebinding). Qui accettiamo qualunque
    // host perché tanto ci arriva solo nginx sulla rete interna.
    allowedHosts: true,
    // Il WebSocket di HMR passa attraverso nginx sulla porta 8443.
    // Diciamo a Vite di pubblicizzare quell'host/porta al browser.
    hmr: {
      host: "192.168.1.24",
      protocol: "wss",
      clientPort: 8443,
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});