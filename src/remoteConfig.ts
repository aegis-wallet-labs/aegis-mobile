import { useEffect, useState } from 'react';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://aegis-ai-api.fly.dev';

// The running app version. app.json is the single source of truth and ships
// with the JS bundle, so for a standalone build this equals the installed
// native versionName. Bump it in app.json (+ android versionName) per release.
export const APP_VERSION: string = (require('../app.json')?.expo?.version as string) || '0.0.0';

/** True when `current` is strictly below `minimum` (dotted numeric compare). */
export function isUpdateRequired(current: string, minimum: string): boolean {
  const parse = (value: string) => String(value || '0').split('.').map((part) => parseInt(part, 10) || 0);
  const a = parse(current);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

export type RemoteConfig = {
  swapEnabled: boolean;
  bridgeEnabled: boolean;
  txBroadcastEnabled: boolean;
  swapFeeBps: number;
  treasuryAddress: string;
  minAppVersion: string;
  loaded: boolean;
};

// Respect the server flag in every build. A dev-only fail-open path made it
// impossible to verify a server-side kill switch on a development client.
const defaults: RemoteConfig = {
  swapEnabled: false,
  bridgeEnabled: false,
  txBroadcastEnabled: false,
  swapFeeBps: 0,
  treasuryAddress: '',
  minAppVersion: '0.0.0',
  loaded: false,
};

let cached: RemoteConfig | null = null;
let inflight: Promise<RemoteConfig> | null = null;

export async function fetchRemoteConfig(): Promise<RemoteConfig> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/config`);
      if (!response.ok) return defaults;
      const data = await response.json();
      cached = {
        swapEnabled: data.swapEnabled === true,
        bridgeEnabled: data.bridgeEnabled === true,
        txBroadcastEnabled: data.txBroadcastEnabled === true,
        swapFeeBps: Number(data.swapFeeBps) || 0,
        treasuryAddress: typeof data.treasuryAddress === 'string' ? data.treasuryAddress : '',
        minAppVersion: data.minAppVersion || '0.0.0',
        loaded: true,
      };
      return cached;
    } catch {
      return defaults;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useRemoteConfig(): RemoteConfig {
  const [config, setConfig] = useState<RemoteConfig>(cached || defaults);
  useEffect(() => {
    let active = true;
    fetchRemoteConfig().then((next) => {
      if (active) setConfig(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return config;
}
