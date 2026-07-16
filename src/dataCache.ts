import * as SecureStore from 'expo-secure-store';

/**
 * Last-known-value cache so screens render the previous balances/activity
 * instantly instead of zeros while fresh data loads. Values live in memory
 * for the session and in SecureStore across launches.
 */
const memory = new Map<string, any>();
const listeners = new Map<string, Set<(value: any) => void>>();

export function subscribeCache(key: string, listener: (value: any) => void) {
  let entries = listeners.get(key);
  if (!entries) {
    entries = new Set();
    listeners.set(key, entries);
  }
  entries.add(listener);
  return () => {
    entries?.delete(listener);
    if (entries?.size === 0) listeners.delete(key);
  };
}

const storeKey = (key: string) => `aegis.cache.v1.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export function getCachedSync(key: string) {
  return memory.get(key);
}

export async function readCache(key: string) {
  if (memory.has(key)) return memory.get(key);
  try {
    const raw = await SecureStore.getItemAsync(storeKey(key));
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    memory.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

export function writeCache(key: string, value: any) {
  memory.set(key, value);
  listeners.get(key)?.forEach((listener) => listener(value));
  try {
    SecureStore.setItemAsync(storeKey(key), JSON.stringify(value)).catch(() => {});
  } catch {}
}
