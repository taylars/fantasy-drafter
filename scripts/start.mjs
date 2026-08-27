/* Serve the static board locally through `npm start`.
 *
 * A server is needed only because ES modules and workers require an origin;
 * production remains the same static files served by GitHub Pages.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 8000;

const server = createServer(async (req, res) => {
  try {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("bad request");
      return;
    }

    const rel = pathname.replace(/^\/+/, "") || "index.html";
    const file = path.resolve(ROOT, rel);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain" }).end("no");
      return;
    }

    const info = await stat(file).catch(() => null);
    if (!info) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }

    const target = info.isDirectory() ? path.join(file, "index.html") : file;
    const body = await readFile(target).catch(() => null);
    if (body === null) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("server error");
    console.error(`${req.method} ${req.url} -> ${err.message}`);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`draft board at http://localhost:${port}`);
  console.log("ctrl-c to stop");
});
