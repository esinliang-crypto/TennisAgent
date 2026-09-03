class WeatherMemoryCache {
  constructor({ ttlMs = 20 * 60 * 1000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return structuredClone(entry.value);
  }

  set(key, value) {
    this.entries.set(key, {
      createdAt: this.now(),
      value: structuredClone(value),
    });
  }

  clear() {
    this.entries.clear();
  }
}

function createWeatherCacheKey({ location, startDate, endDate }) {
  return [
    Number(location.latitude).toFixed(4),
    Number(location.longitude).toFixed(4),
    location.timezone,
    startDate,
    endDate,
  ].join('|');
}

export {
  WeatherMemoryCache,
  createWeatherCacheKey,
};
