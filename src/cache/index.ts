import NodeCache from 'node-cache';

// Separate caches per data type so TTLs can be tuned independently.
// All times are in seconds.
const TTL = {
  productDetail: 60 * 60,      // 1 hour  – products rarely change after scraping
  productList:   60 * 10,      // 10 min  – listings change with new scrapes
  categories:    60 * 30,      // 30 min
  search:        60 * 5,       // 5 min   – queries are diverse; keep short
} as const;

const cache = new NodeCache({ useClones: false });

export type CacheTtlKey = keyof typeof TTL;

export function cacheGet<T>(key: string): T | undefined {
  return cache.get<T>(key);
}

export function cacheSet<T>(key: string, value: T, ttlKey: CacheTtlKey): void {
  cache.set(key, value, TTL[ttlKey]);
}

/** Build a deterministic cache key from a route name + sorted query params. */
export function buildCacheKey(route: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .map(k => `${k}=${String(params[k])}`)
    .join('&');
  return `${route}?${sorted}`;
}

export function cacheStats() {
  return cache.getStats();
}
