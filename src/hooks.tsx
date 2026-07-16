import { useEffect, useState } from 'react';
import { getCachedSync, readCache, subscribeCache, writeCache } from './dataCache';
import { defaultTokens, fetchWalletActivity, fetchWalletAssets, fetchWalletNfts } from './qoreWallet';

// Caches are keyed per network AND per wallet address, so switching wallets
// resets instantly to that wallet's last-known data — never another wallet's.
const walletCacheKey = (prefix: string, networkKey: string, wallet: any) =>
  `${prefix}.${networkKey}.${wallet?.accounts?.native?.address || 'none'}`;

/** Tokens with balances: cached value renders immediately, fresh data replaces it. */
export function useWalletAssets(wallet: any, networkKey: string, refreshKey = 0) {
  const cacheKey = walletCacheKey('assets', networkKey, wallet);
  const [tokens, setTokens] = useState<any[]>(() => getCachedSync(cacheKey) || defaultTokens);
  const [hydrated, setHydrated] = useState(() => Boolean(getCachedSync(cacheKey)));
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    // Reset to THIS wallet's cache the moment the key changes.
    const cachedNow = getCachedSync(cacheKey);
    setTokens(cachedNow || defaultTokens);
    setHydrated(Boolean(cachedNow));
    setError('');

    readCache(cacheKey).then((cached) => {
      if (active && cached) {
        setTokens(cached);
        setHydrated(true);
      }
    });
    fetchWalletAssets(wallet, networkKey as any)
      .then((fresh: any[]) => {
        if (!active) return;
        setTokens(fresh);
        setHydrated(true);
        setError('');
        writeCache(cacheKey, fresh);
      })
      .catch((caught: any) => {
        if (active) setError(caught?.message || 'Unable to load wallet data.');
      });
    return () => {
      active = false;
    };
  }, [cacheKey, refreshKey]);

  return { tokens, hydrated, error };
}

const trimActivity = (rows: any[]) =>
  rows.slice(0, 12).map((row) => ({
    hash: row.hash,
    title: row.title,
    status: row.status,
    height: row.height,
    timestamp: row.timestamp,
    explorerUrl: row.explorerUrl,
    kind: row.kind,
    symbol: row.symbol,
    amount: row.amount,
    counterparty: row.counterparty,
    description: row.description,
  }));

/** NFTs owned by the wallet's native address, cache-first. */
export function useWalletNfts(wallet: any, networkKey: string, refreshKey = 0) {
  const cacheKey = walletCacheKey('nfts', networkKey, wallet);
  const [nfts, setNfts] = useState<any[]>(() => getCachedSync(cacheKey) || []);
  const [hydrated, setHydrated] = useState(() => Boolean(getCachedSync(cacheKey)));

  useEffect(() => {
    let active = true;
    const cachedNow = getCachedSync(cacheKey);
    setNfts(cachedNow || []);
    setHydrated(Boolean(cachedNow));

    readCache(cacheKey).then((cached) => {
      if (active && cached) {
        setNfts(cached);
        setHydrated(true);
      }
    });
    fetchWalletNfts(wallet, networkKey as any)
      .then((fresh: any[]) => {
        if (!active) return;
        setNfts(fresh);
        setHydrated(true);
        writeCache(cacheKey, fresh);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [cacheKey, refreshKey]);

  return { nfts, hydrated };
}

/** Recent activity with the same cache-first behavior. */
export function useWalletActivity(wallet: any, networkKey: string, refreshKey = 0) {
  const cacheKey = walletCacheKey('activity', networkKey, wallet);
  const [activity, setActivity] = useState<any[]>(() => getCachedSync(cacheKey) || []);
  const [hydrated, setHydrated] = useState(() => Boolean(getCachedSync(cacheKey)));

  useEffect(() => {
    let active = true;
    const cachedNow = getCachedSync(cacheKey);
    setActivity(cachedNow || []);
    setHydrated(Boolean(cachedNow));

    const unsubscribe = subscribeCache(cacheKey, (next) => {
      if (active) {
        setActivity(next || []);
        setHydrated(true);
      }
    });
    readCache(cacheKey).then((cached) => {
      if (active && cached) {
        setActivity(cached);
        setHydrated(true);
      }
    });
    fetchWalletActivity(wallet, networkKey as any)
      .then((fresh: any[]) => {
        if (!active) return;
        const trimmed = trimActivity(fresh);
        setActivity(trimmed);
        setHydrated(true);
        writeCache(cacheKey, trimmed);
      })
      .catch(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [cacheKey, refreshKey]);

  return { activity, hydrated };
}
