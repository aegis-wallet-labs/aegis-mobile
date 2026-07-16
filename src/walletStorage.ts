import * as SecureStore from 'expo-secure-store';

const MNEMONIC_KEY = 'aegis.qore.mnemonic.v1'; // legacy single-wallet key (migrated)
const WALLETS_KEY = 'aegis.qore.wallets.v1';
const ACTIVE_WALLET_KEY = 'aegis.qore.activewallet.v1';
const NETWORK_KEY = 'aegis.qore.network.v1';

export const MAX_WALLETS = 10;

const secureOpts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

// ── Multi-wallet store ───────────────────────────────────────────────────────
// [{ id, label, mnemonic, createdAt }] — all wallets share the app passcode.

async function readWalletList() {
  try {
    const raw = await SecureStore.getItemAsync(WALLETS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((item) => item?.mnemonic) : [];
  } catch {
    return [];
  }
}

async function writeWalletList(list) {
  await SecureStore.setItemAsync(WALLETS_KEY, JSON.stringify(list), secureOpts);
}

/** Returns the wallet list, migrating the legacy single-mnemonic store once. */
export async function getWallets() {
  let list = await readWalletList();
  if (list.length === 0) {
    const legacy = await SecureStore.getItemAsync(MNEMONIC_KEY);
    if (legacy) {
      list = [{ id: `w-${Date.now()}`, label: 'Wallet 1', mnemonic: legacy, createdAt: Date.now() }];
      await writeWalletList(list);
      await SecureStore.setItemAsync(ACTIVE_WALLET_KEY, list[0].id);
      await SecureStore.deleteItemAsync(MNEMONIC_KEY);
    }
  }
  return list;
}

export async function getActiveWalletId() {
  return SecureStore.getItemAsync(ACTIVE_WALLET_KEY);
}

export async function setActiveWalletId(id) {
  await SecureStore.setItemAsync(ACTIVE_WALLET_KEY, String(id));
}

export async function addWallet({ label, mnemonic, addressPreview }) {
  const list = await getWallets();
  if (list.length >= MAX_WALLETS) {
    throw new Error(`You can hold up to ${MAX_WALLETS} wallets. Delete one to add another.`);
  }
  const normalized = String(mnemonic || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (list.some((item) => item.mnemonic === normalized)) {
    throw new Error('This wallet is already on this device.');
  }
  const cleanLabel = String(label || '').trim();
  if (cleanLabel && list.some((item) => item.label.toLowerCase() === cleanLabel.toLowerCase())) {
    throw new Error(`You already have a wallet named “${cleanLabel}”. Pick a different name.`);
  }
  const entry = {
    id: `w-${Date.now()}`,
    label: cleanLabel || `Wallet ${list.length + 1}`,
    mnemonic: normalized,
    addressPreview: addressPreview || '',
    createdAt: Date.now(),
  };
  await writeWalletList([...list, entry]);
  return entry;
}

export async function renameWallet(id, label) {
  const list = await getWallets();
  const cleanLabel = String(label || '').trim();
  if (cleanLabel && list.some((item) => item.id !== id && item.label.toLowerCase() === cleanLabel.toLowerCase())) {
    throw new Error(`You already have a wallet named “${cleanLabel}”. Pick a different name.`);
  }
  const next = list.map((item) => (item.id === id ? { ...item, label: cleanLabel || item.label } : item));
  await writeWalletList(next);
  return next;
}

/** Removes one wallet. Returns the remaining list (empty = device is wallet-less). */
export async function removeWallet(id) {
  const list = await getWallets();
  const next = list.filter((item) => item.id !== id);
  await writeWalletList(next);
  const activeId = await getActiveWalletId();
  if (activeId === id && next.length) {
    await setActiveWalletId(next[0].id);
  }
  if (next.length === 0) {
    await SecureStore.deleteItemAsync(ACTIVE_WALLET_KEY);
    await SecureStore.deleteItemAsync(WALLETS_KEY);
  }
  return next;
}
export async function getStoredNetwork() {
  const stored = await SecureStore.getItemAsync(NETWORK_KEY);
  return stored === 'mainnet' ? 'mainnet' : 'testnet';
}

export async function saveNetwork(networkKey) {
  const normalized = networkKey === 'testnet' ? 'testnet' : 'mainnet';
  await SecureStore.setItemAsync(NETWORK_KEY, normalized, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return normalized;
}

const importedKey = (networkKey) => `aegis.qore.imported.${networkKey === 'testnet' ? 'testnet' : 'mainnet'}.v1`;

export async function getImportedTokens(networkKey) {
  try {
    const raw = await SecureStore.getItemAsync(importedKey(networkKey));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveImportedToken(networkKey, token) {
  const list = await getImportedTokens(networkKey);
  const next = [...list.filter((item) => item.denom !== token.denom), token];
  await SecureStore.setItemAsync(importedKey(networkKey), JSON.stringify(next));
  return next;
}

// ── Contacts (shared across wallets and networks) ────────────────────────────
const CONTACTS_KEY = 'aegis.qore.contacts.v1';

export async function getContacts() {
  try {
    const raw = await SecureStore.getItemAsync(CONTACTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveContact({ name, address }) {
  const cleanName = String(name || '').trim();
  const cleanAddress = String(address || '').trim();
  if (!cleanName) throw new Error('Give this contact a name.');
  if (!cleanAddress) throw new Error('A wallet address is required.');
  const list = await getContacts();
  const existing = list.find((item) => item.address === cleanAddress);
  const next = existing
    ? list.map((item) => (item.address === cleanAddress ? { ...item, name: cleanName } : item))
    : [...list, { id: `c-${Date.now()}`, name: cleanName, address: cleanAddress, createdAt: Date.now() }];
  await SecureStore.setItemAsync(CONTACTS_KEY, JSON.stringify(next));
  return next;
}

export async function removeContact(id) {
  const next = (await getContacts()).filter((item) => item.id !== id);
  await SecureStore.setItemAsync(CONTACTS_KEY, JSON.stringify(next));
  return next;
}

const DAPP_CONNECTIONS_KEY = 'aegis.qore.dapporigins.v2';
const legacyOriginsKey = (networkKey) =>
  'aegis.qore.dapporigins.' + (networkKey === 'testnet' ? 'testnet' : 'mainnet') + '.v1';
const DAPP_LANES = ['evm', 'cosmos', 'svm'];

// A connection grants the origin access to the wallet's public addresses on
// every QoreChain VM. It is intentionally independent of the active network.
const normalizeConnection = (entry) => ({
  origin: typeof entry === 'string' ? entry : entry?.origin || '',
  lanes: [...DAPP_LANES],
});

async function readDappConnections(key) {
  try {
    const raw = await SecureStore.getItemAsync(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(normalizeConnection).filter((item) => item.origin) : [];
  } catch {
    return [];
  }
}

export async function getDappConnections(_networkKey?) {
  try {
    const stored = await SecureStore.getItemAsync(DAPP_CONNECTIONS_KEY);
    if (stored !== null) {
      const current = JSON.parse(stored);
      return Array.isArray(current)
        ? current.map(normalizeConnection).filter((item) => item.origin)
        : [];
    }
  } catch {
    return [];
  }

  const legacy = [
    ...(await readDappConnections(legacyOriginsKey('mainnet'))),
    ...(await readDappConnections(legacyOriginsKey('testnet'))),
  ];
  const migrated = legacy.filter(
    (item, index, list) => list.findIndex((candidate) => candidate.origin === item.origin) === index,
  );
  await SecureStore.setItemAsync(DAPP_CONNECTIONS_KEY, JSON.stringify(migrated));
  return migrated;
}

export async function saveDappConnection(_networkKey, origin, _lane?) {
  const list = await getDappConnections();
  if (!list.some((item) => item.origin === origin)) {
    list.push(normalizeConnection({ origin }));
  }
  await SecureStore.setItemAsync(DAPP_CONNECTIONS_KEY, JSON.stringify(list));
  return list;
}

export async function removeDappConnection(_networkKey, origin) {
  const list = (await getDappConnections()).filter((item) => item.origin !== origin);
  await SecureStore.setItemAsync(DAPP_CONNECTIONS_KEY, JSON.stringify(list));
  return list;
}

// ── Browser history (recent sites, device-wide) ──────────────────────────────
// One entry per origin (most recent first), so the launcher shows distinct
// sites rather than every page. Kept in memory-only React state during a
// session and here for cross-launch persistence.
const BROWSER_HISTORY_KEY = 'aegis.qore.browserhistory.v1';
// Kept small on purpose: SecureStore warns past ~2KB on Android, and the
// launcher only surfaces the most recent handful anyway.
const MAX_BROWSER_HISTORY = 12;

export async function getBrowserHistory() {
  try {
    const raw = await SecureStore.getItemAsync(BROWSER_HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((item) => item?.origin) : [];
  } catch {
    return [];
  }
}

/** Records (or bumps) one site visit. `url` is the full page; display uses origin. */
export async function recordBrowserVisit(url) {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) return getBrowserHistory();
  let origin = '';
  try {
    origin = new URL(clean).origin;
  } catch {
    return getBrowserHistory();
  }
  if (!origin) return getBrowserHistory();
  const list = await getBrowserHistory();
  const next = [
    { origin, url: clean, lastAt: Date.now() },
    ...list.filter((item) => item.origin !== origin),
  ].slice(0, MAX_BROWSER_HISTORY);
  await SecureStore.setItemAsync(BROWSER_HISTORY_KEY, JSON.stringify(next));
  return next;
}

export async function clearBrowserHistory() {
  await SecureStore.deleteItemAsync(BROWSER_HISTORY_KEY);
  return [];
}

// ── Local transaction log (per wallet + network) ─────────────────────────────
// The activity feed is otherwise built from confirmed on-chain history only, so
// a transaction that fails at broadcast (or is still pending) shows nothing.
// We record each submitted tx locally as pending → success/failed and merge it
// into the feed; a matching on-chain entry supersedes the local one.
const localTxKey = (networkKey, address) =>
  `aegis.qore.localtx.${networkKey === 'testnet' ? 'testnet' : 'mainnet'}.${address || 'none'}.v1`;
const MAX_LOCAL_TX = 15;

export async function getLocalTxs(networkKey, address) {
  try {
    const raw = await SecureStore.getItemAsync(localTxKey(networkKey, address));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function recordLocalTx(networkKey, address, tx) {
  const list = await getLocalTxs(networkKey, address);
  const next = [{ at: Date.now(), ...tx }, ...list.filter((item) => item.id !== tx.id)].slice(0, MAX_LOCAL_TX);
  await SecureStore.setItemAsync(localTxKey(networkKey, address), JSON.stringify(next));
  return next;
}

export async function updateLocalTx(networkKey, address, id, patch) {
  const list = await getLocalTxs(networkKey, address);
  const next = list.map((item) => (item.id === id ? { ...item, ...patch } : item));
  await SecureStore.setItemAsync(localTxKey(networkKey, address), JSON.stringify(next));
  return next;
}
