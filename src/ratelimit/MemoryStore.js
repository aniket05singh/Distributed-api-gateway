export class MemoryStore {
  constructor() {
    this.buckets = new Map();
  }

  async get(key) {
    return this.buckets.get(key) || null;
  }

  async set(key, value) {
    this.buckets.set(key, value);
  }

  async clear() {
    this.buckets.clear();
  }
}