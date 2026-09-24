import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";

// Cartella dei certificati generati da Docker + mkcert (root del monorepo).
const CERTS_DIR = path.resolve(__dirname, "../../certs");
const KEY_PATH = path.join(CERTS_DIR, "local-key.pem");
const CERT_PATH = path.join(CERTS_DIR, "local.pem");

// HTTPS attivo solo se entrambi i file esistono, altrimenti fallback a HTTP
// silenzioso. Così Vite non crasha quando i cert non sono ancora stati generati
// (es. primo clone, o mkcert non ancora eseguito).
const httpsConfig =
  fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)
    ? {
        key: fs.readFileSync(KEY_PATH),
        cert: fs.readFileSync(CERT_PATH),
      }
    : undefined;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // host: true espone il dev server sulla rete locale (necessario per
    // testare la scansione QR dal telefono, che deve raggiungere l'host).
    host: true,
    ...(httpsConfig ? { https: httpsConfig } : {}),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});