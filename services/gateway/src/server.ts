import http from "node:http";
import { metricsHandler, requestObservability, startObservability, log } from "./observability.js";

const port = Number(process.env.PORT ?? 3000);
const routes = [{ prefix: "/api/v1/auth", target: process.env.IDENTITY_URL ?? "http://identity:3010", upstreamPrefix: "/auth" }];
const obs = requestObservability();

const proxy = async (req: http.IncomingMessage, res: http.ServerResponse, target: string, path: string): Promise<void> => {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key === "host" || value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(",") : value;
  }
  try {
    const upstream = await fetch(target + path, {
      method: req.method ?? "GET",
      headers,
      ...(req.method && !["GET", "HEAD"].includes(req.method)
        ? { body: req as unknown as BodyInit, duplex: "half" as const }
        : {}),
    });
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (key !== "transfer-encoding") res.setHeader(key, value);
    });
    res.end(await upstream.arrayBuffer());
  } catch (error) {
    log.error("gateway.upstream_unavailable", { target, path }, error);
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "upstream_unavailable" }));
  }
};

startObservability("gateway");
http.createServer((req, res) => {
  obs(req as never, res as never, () => void (async () => {
    if (req.url === "/metrics") return metricsHandler(req, res);
    if (req.url === "/health/live") {
      res.statusCode = 200; res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "ok", service: "gateway" })); return;
    }
    if (req.url === "/health/ready") {
      res.statusCode = 200; res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "ok", service: "gateway", ready: true })); return;
    }
    const requestPath = req.url ?? "/";
    const match = routes.find(r => requestPath === r.prefix || requestPath.startsWith(r.prefix + "/"));
    if (match) {
      const suffix = requestPath.slice(match.prefix.length) || "/";
      await proxy(req, res, match.target, match.upstreamPrefix + suffix); return;
    }
    res.statusCode = 404; res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "route_not_found", service: "gateway" }));
  })());
}).listen(port, "0.0.0.0", () => log.info("service.started", { port }));
