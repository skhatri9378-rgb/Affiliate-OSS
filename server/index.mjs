import { createServer } from "node:http";
import { readFile, unlink } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { LinkChecker } from "./link-health.mjs";
import { Store } from "./store.mjs";
export function appServer(
  store,
  { port = 4317, devPort = 1420, dist = resolve("dist") } = {},
) {
  const origins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${devPort}`,
    `http://localhost:${devPort}`,
  ]);
  const checker = new LinkChecker(store);
  checker.schedule();
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const host = req.headers.host?.split(":")[0];
    if (!["127.0.0.1", "localhost"].includes(host)) {
      res.writeHead(403);
      res.end("Local access only");
      return;
    }
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        if (req.headers.origin && !origins.has(req.headers.origin))
          throw Error("This origin is not allowed.");
        if (req.method === "GET" && url.pathname === "/api/state") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify(
              store.snapshot(Object.fromEntries(url.searchParams)),
            ),
          );
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/health") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(checker.status()));
          return;
        }
        if (req.method === "POST") {
          if (
            !origins.has(req.headers.origin) ||
            !req.headers["content-type"]?.startsWith("application/json")
          )
            throw Error("Use this app from its local browser window.");
          let raw = "";
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 100000) throw Error("Request is too large.");
          }
          const body = JSON.parse(raw || "{}");
          let data;
          if (url.pathname === "/api/health/settings")
            data = checker.setEnabled(body.enabled);
          else if (url.pathname === "/api/health/run")
            data = checker.start({
              websiteId: body.websiteId || "",
              force: true,
            });
          else if (url.pathname === "/api/link") data = store.saveLink(body);
          else if (url.pathname === "/api/label") data = store.saveLabel(body);
          else if (url.pathname === "/api/delete-label")
            data = store.deleteLabel(body);
          else if (url.pathname === "/api/delete-link") {
            store.deleteLink(body.id);
            data = { ok: true };
          } else if (url.pathname === "/api/backup") {
            const path = join(
              tmpdir(),
              `affiliate-manager-${randomUUID()}.sqlite`,
            );
            try {
              await store.backup(path);
              res.setHeader("Content-Type", "application/vnd.sqlite3");
              res.setHeader(
                "Content-Disposition",
                `attachment; filename="Affiliate-Links-${new Date().toISOString().replaceAll(":", "-")}.sqlite"`,
              );
              res.end(await readFile(path));
            } finally {
              await unlink(path).catch(() => {});
            }
            return;
          } else throw Error("Unknown action");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data ?? { ok: true }));
          return;
        }
        throw Error("Unknown API endpoint");
      }
      if (req.method !== "GET") {
        res.writeHead(405);
        res.end();
        return;
      }
      const requested = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      if (!requested.startsWith(`${dist}/`) && requested !== dist)
        throw Error("Invalid path");
      let file = requested;
      if (!extname(file)) file = join(dist, "index.html");
      let content;
      try {
        content = await readFile(file);
      } catch {
        res.writeHead(404);
        res.end("Build the app with npm run build before running npm start.");
        return;
      }
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        }[extname(file)] || "application/octet-stream",
      );
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      );
      res.end(content);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: error.message || "The action could not be completed.",
        }),
      );
    }
  });
  server.on("listening", () => {
    const address = server.address();
    if (address && typeof address !== "string")
      origins.add(`http://127.0.0.1:${address.port}`);
  });
  server.on("close", () => checker.stop());
  return server;
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const port = Number(process.env.PORT) || 4317;
  const path = process.env.AFFILIATE_OS_DATA_DIR
    ? join(process.env.AFFILIATE_OS_DATA_DIR, "affiliate-os.sqlite")
    : join(
        homedir(),
        "Library",
        "Application Support",
        "com.affiliateos.desktop",
        "affiliate-os.sqlite",
      );
  const store = new Store(path);
  const server = appServer(store, { port });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Affiliate Links is ready at http://127.0.0.1:${port}`),
  );
  server.on("error", (e) => {
    console.error(e.message);
    store.close();
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(() => {
        store.close();
        process.exit(0);
      }),
    );
}
