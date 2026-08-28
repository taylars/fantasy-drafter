/* A cache on disk, for the Sleeper client running under Node.
 *
 * Node-only: it imports node:fs, so the browser must never load this file. The
 * browser's equivalent lives in cache-idb.js, and SleeperClient takes whichever
 * one it's handed.
 *
 * This exists so that running the board or a grading pass from the command line
 * costs one request for the projections rather than one per invocation. Three
 * megabytes fetched every time an agent asks what a player is worth is exactly
 * the sort of thing that gets a client rate-limited.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const DEFAULT_DIR = "data/cache";

export class FileCache {
  constructor(dir = DEFAULT_DIR) {
    this.dir = dir;
  }

  // The key is a url-ish string, so it is hashed rather than escaped: a
  // filename built from a query string is a portability problem waiting to
  // happen. The readable prefix is there so a stale entry can be spotted by eye.
  path(key) {
    const slug = key.replace(/[^a-z0-9]+/gi, "-").slice(0, 48);
    const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
    return path.join(this.dir, `${slug}-${digest}.json`);
  }

  async get(key) {
    try {
      const { expires, value } = JSON.parse(await readFile(this.path(key), "utf8"));
      // An expired entry is left on disk rather than deleted: the next `set`
      // overwrites it, and a failed refetch is not a reason to also lose what
      // we had.
      return Date.now() < expires ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async set(key, value, ttlMs) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(key), JSON.stringify({ expires: Date.now() + ttlMs, value }));
  }
}
