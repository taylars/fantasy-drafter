/* A cache in IndexedDB, for the Sleeper client running in a browser.
 *
 * Browser-only: the Node equivalent is cache-fs.js, and SleeperClient takes
 * whichever one it's handed.
 *
 * This is what keeps the board off Sleeper's back. The projections response is
 * three megabytes and answers a question — what is every player projected for,
 * and where does the room draft him — whose answer moves over days. Refetching
 * it on every page load would be three megabytes per reload for data that
 * hasn't changed, which is both slow for whoever opened the page and rude to a
 * free API.
 *
 * localStorage is the wrong tool here: it is synchronous, it caps around 5MB,
 * and it only stores strings, so a 3MB response would have to be re-parsed on
 * every read. IndexedDB stores the parsed object and hands it back off the main
 * thread.
 */

const DB_NAME = "fantasy-drafter";
const DB_VERSION = 1;
const STORE = "responses";

let open = null;

function database() {
  if (open) return open;
  open = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return open;
}

function run(mode, work) {
  return database().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export class IndexedDbCache {
  /* Every method swallows its own failures. A browser in private mode, one
   * with storage disabled, or one that has hit its quota should cost the board
   * its cache and nothing else — a page that refuses to open because it could
   * not save a copy of something it just fetched is strictly worse than a slow
   * one.
   */
  async get(key) {
    try {
      const hit = await run("readonly", (store) => store.get(key));
      if (!hit) return undefined;
      // An expired entry is left in place rather than deleted: the next `set`
      // overwrites it, and a failed refetch is not a reason to also lose what
      // we had.
      return Date.now() < hit.expires ? hit.value : undefined;
    } catch {
      return undefined;
    }
  }

  async set(key, value, ttlMs) {
    try {
      await run("readwrite", (store) => store.put({ expires: Date.now() + ttlMs, value }, key));
    } catch {
      /* over quota, or storage turned off — the board just refetches next time */
    }
  }

  /* Drop everything. Behind the board's "refresh data" affordance, for when
   * ADP has moved and waiting out the ttl isn't good enough. */
  async clear() {
    try {
      await run("readwrite", (store) => store.clear());
    } catch {
      /* nothing to clear, or nowhere to clear it */
    }
  }
}
