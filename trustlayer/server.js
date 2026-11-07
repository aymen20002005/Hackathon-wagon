import "../src/env.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTrustLayer } from "./service.js";
import { runTestPack } from "./testpack.js";

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const SCENARIOS = [
  { step: 1, id: "normal", label: "01 Normal record", page: "orbis.html", note: "A clean company page: fields with source evidence." },
  { step: 2, id: "poison", label: "02 Controlled poison page", page: "orbis-poison.html", note: "Hidden instruction payload + an unsupported revenue claim." },
];
const EXTRA = [
  { id: "hidden", label: "Claim only in hidden text", page: "orbis-hidden.html" },
  { id: "conflict", label: "Conflicting founding years", page: "orbis-conflict.html" },
  { id: "stale", label: "Stale page (2021)", page: "orbis-stale.html" },
  { id: "sparse", label: "Sparse page", page: "orbis-sparse.html" },
  { id: "injection", label: "Visible injection", page: "orbis-injection.html" },
  { id: "missing", label: "Source failure (404)", page: "missing.html" },
];

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  if (!String(req.headers["content-type"]).startsWith("application/json")) throw new Error("JSON body required");
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 10_000) throw new Error("Body too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

export async function startServer({ port = 4174 } = {}) {
  let layer;
  let baseUrl;

  const server = http.createServer(async (req, res) => {
    try {
      // Reject foreign Host headers (DNS rebinding) since this app has no authentication.
      const host = String(req.headers.host ?? "").split(":")[0];
      if (!LOCAL_HOSTS.has(host)) return json(res, 403, { error: "forbidden host" });
      const url = new URL(req.url, "http://localhost");

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        });
        return res.end(await readFile(dir("public/index.html")));
      }

      const page = /^\/testpages\/([a-z0-9-]+\.html)$/.exec(url.pathname);
      if (req.method === "GET" && page) {
        let html;
        try {
          html = await readFile(dir(`testpages/${page[1]}`), "utf8");
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain" });
          return res.end("Not found");
        }
        const updated = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
        return res.end(html.replaceAll("{{updated}}", updated));
      }

      if (req.method === "GET" && url.pathname === "/api/config") {
        const withUrl = (s) => ({ ...s, url: `${baseUrl}/testpages/${s.page}` });
        return json(res, 200, { baseUrl, scenarios: SCENARIOS.map(withUrl), extra: EXTRA.map(withUrl), scorton: { enabled: layer.scorton.enabled } });
      }
      if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, layer.state());
      if (req.method === "GET" && url.pathname === "/api/testpack") return json(res, 200, await runTestPack({ baseUrl, allowedHosts: allowed(baseUrl) }));

      if (req.method === "POST" && url.pathname === "/api/enrich") {
        const { url: target } = await readJson(req);
        return json(res, 200, await layer.enrich(target));
      }
      if (req.method === "POST" && url.pathname === "/api/review") {
        const { id, decision, note } = await readJson(req);
        return json(res, 200, layer.review(id, decision, note));
      }
      if (req.method === "POST" && url.pathname === "/api/reset") {
        layer.reset();
        return json(res, 200, { ok: true });
      }
      json(res, 404, { error: "not found" });
    } catch (e) {
      json(res, 400, { error: String(e.message).slice(0, 200) });
    }
  });

  const allowed = (base) => {
    const u = new URL(base);
    const extra = (process.env.ALLOWED_DOMAINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return [`localhost:${u.port}`, `127.0.0.1:${u.port}`, ...extra];
  };

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = server.address().port;
  baseUrl = `http://localhost:${actual}`;
  layer = createTrustLayer({ allowedHosts: allowed(baseUrl) });
  return { server, port: actual, baseUrl, layer };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { baseUrl } = await startServer({ port: Number(process.env.PORT ?? 4174) });
  console.log(`TRUSTLAYER AI demo: ${baseUrl}`);
}
