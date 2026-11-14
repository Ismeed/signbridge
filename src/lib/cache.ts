/**
 * Bounded LRU-like in-memory cache using Map insertion order.
 */
export class BoundedCache<V> {
  private readonly entries = new Map<string, V>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = 100) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  public get(key: string): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  public set(key: string, value: V): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, value);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}
