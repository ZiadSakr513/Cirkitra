import type { CoordinatedWireInput, CoordinatedWireRoute, SchematicComponentLike } from "./geometry.ts";

const DATABASE_NAME = "cirkitra-derived-cache";
const STORE_NAME = "wire-routes";
const ROUTER_VERSION = 2;
const MAX_CACHED_LAYOUTS = 12;

export interface WireRouteCacheInput {
  wires: readonly CoordinatedWireInput[];
  components: readonly SchematicComponentLike[];
}

interface CachedWireRoutes {
  key: string;
  signature: string;
  savedAt: number;
  routes: CoordinatedWireRoute[];
}

function signatureFor(input: WireRouteCacheInput) {
  return JSON.stringify({ routerVersion: ROUTER_VERSION, wires: input.wires, components: input.components });
}

function cacheKeyForSignature(signature: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `wire-routes-v${ROUTER_VERSION}:${(hash >>> 0).toString(16)}:${signature.length}`;
}

export function wireRouteCacheKey(input: WireRouteCacheInput) {
  return cacheKeyForSignature(signatureFor(input));
}

export function isCompleteWireRouteSet(
  routes: readonly CoordinatedWireRoute[],
  wires: readonly CoordinatedWireInput[],
) {
  if (routes.length !== wires.length) return false;
  const routesById = new Map(routes.map((route) => [route.id, route]));
  if (routesById.size !== routes.length) return false;
  return wires.every((wire) => {
    const route = routesById.get(wire.id);
    const first = route?.segments[0];
    const last = route?.segments.at(-1);
    return Boolean(first && last &&
      first.from.x === wire.from.point.x && first.from.y === wire.from.point.y &&
      last.to.x === wire.to.point.x && last.to.y === wire.to.point.y &&
      route!.segments.every((segment) =>
        Number.isFinite(segment.from.x) && Number.isFinite(segment.from.y) &&
        Number.isFinite(segment.to.x) && Number.isFinite(segment.to.y) &&
        (segment.from.x === segment.to.x || segment.from.y === segment.to.y),
      ));
  });
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readCachedWireRoutes(input: WireRouteCacheInput): Promise<CoordinatedWireRoute[] | null> {
  const signature = signatureFor(input);
  const key = cacheKeyForSignature(signature);
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const cached = await requestValue(transaction.objectStore(STORE_NAME).get(key)) as CachedWireRoutes | undefined;
    if (!cached || cached.signature !== signature || !isCompleteWireRouteSet(cached.routes, input.wires)) return null;
    return cached.routes;
  } catch {
    return null;
  } finally {
    database.close();
  }
}

export async function writeCachedWireRoutes(input: WireRouteCacheInput, routes: readonly CoordinatedWireRoute[]) {
  if (!isCompleteWireRouteSet(routes, input.wires)) return;
  const signature = signatureFor(input);
  const key = cacheKeyForSignature(signature);
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const transactionDone = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    store.put({ key, signature, savedAt: Date.now(), routes: structuredClone(routes) as CoordinatedWireRoute[] } satisfies CachedWireRoutes);
    const entries = await requestValue(store.getAll()) as CachedWireRoutes[];
    const expired = entries
      .filter((entry) => entry.key !== key)
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(MAX_CACHED_LAYOUTS - 1);
    for (const entry of expired) store.delete(entry.key);
    await transactionDone;
  } catch {
    // Derived routing data is disposable; storage quota or privacy settings must not block editing.
  } finally {
    database.close();
  }
}
