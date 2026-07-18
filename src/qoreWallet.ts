import {
  amm,
  bank,
  bridge,
  ibc,
  buildRegisterPqcKeyMsg,
  createClient,
  deriveEvmAccount,
  deriveUnifiedAccount,
  AlgorithmDilithium5,
  buildHybridSignatureExtension,
  encodeHybridExtension,
  EthNativeSigner,
  ETHSECP256K1_PUBKEY_TYPE,
  HYBRID_SIG_TYPE_URL,
  generateMnemonic,
  getNetwork,
  keccak256,
  msg as qoreMsg,
  isValidBech32,
  isValidEvmAddress,
  isValidSvmAddress,
  qoreAddresses,
  pqcSign,
  qorechainRegistry,
  fromBase,
  formatUnits,
  parseUnits,
  toBase,
  type NetworkName,
} from '@qorechain/sdk';
import { createEvmClient, erc20, evmAccountFromPrivateKey, PRECOMPILE_ADDRESSES } from '@qorechain/evm';
import { formatAmountDisplay, formatUsdDisplay, formatUsdPrice } from './format';
import { getImportedTokens, getLocalTxs, getPriceChange24h, isPqcRegistered, markPqcRegistered, recordPriceSnapshot } from './walletStorage';
import { createMemoInstruction, createSvmClient } from '@qorechain/svm';
import { PublicKey } from '@solana/web3.js';
import { secp256k1 } from '@noble/curves/secp256k1';
import { AuthInfo, SignDoc, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys';
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx';

export { fromBase };

/**
 * Native QOR transfers need one minimum network fee and may need a second one
 * when the wallet registers its PQC key on its first hybrid transaction.
 */
function nativeTransferFeeReserveBase(networkKey = defaultNetworkKey) {
  const gasPrice = Number.parseFloat(getNetworkConfig(networkKey).minGasPrice) || 0.1;
  const feeBase = BigInt(Math.max(100000, Math.ceil(700000 * gasPrice)));
  return feeBase * 2n;
}

export function nativeTransferFeeReserve(networkKey = defaultNetworkKey) {
  return fromBase(nativeTransferFeeReserveBase(networkKey).toString(), { exponent: 6 });
}

export function maxSendableQor(balance = '0', networkKey = defaultNetworkKey) {
  const availableBase = BigInt(toBase(normalizeAmount(balance)));
  const reserveBase = nativeTransferFeeReserveBase(networkKey);
  const sendableBase = availableBase > reserveBase ? availableBase - reserveBase : 0n;
  return fromBase(sendableBase.toString(), { exponent: 6 });
}

// The SDK's isValidSvmAddress requires an on-curve ed25519 point, but
// QoreChain's unified SVM addresses (padded 20-byte accounts) and Solana PDAs
// are off-curve yet valid recipients — accept any 32-byte base58 value.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function isSvm32ByteAddress(value) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const bytes = [0];
  for (const char of value) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry === -1) return false;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let index = 0; index < value.length && value[index] === '1'; index += 1) bytes.push(0);
  return bytes.length === 32;
}

/** True for address formats supported by the wallet's current send paths. */
export function isValidWalletAddress(address) {
  const value = String(address || '').trim();
  if (!value) return false;
  if (value.startsWith('qor1')) return isValidBech32(value, 'qor');
  if (/^0x/i.test(value)) return isValidEvmAddress(value);
  return isValidSvmAddress(value) || isSvm32ByteAddress(value);
}

/** QoreChain native and EVM addresses are two encodings of one 20-byte account. */
export function toEvmAddress(address) {
  const value = String(address || '').trim();
  if (isValidEvmAddress(value)) return value;
  if (isValidBech32(value, 'qor')) return qoreAddresses({ cosmos: value }).evm;
  if (isValidSvmAddress(value)) {
    throw new Error("SVM addresses cannot receive EVM-lane transfers. Use the recipient's qor1 or 0x address.");
  }
  throw new Error('Enter a valid qor1 or 0x recipient address.');
}

export function toNativeAddress(address) {
  const value = String(address || '').trim();
  if (isValidBech32(value, 'qor')) return value;
  if (isValidEvmAddress(value)) return qoreAddresses({ evm: value }).cosmos;
  if (isValidSvmAddress(value)) {
    throw new Error("SVM addresses can only receive on the SVM lane. Use the recipient's qor1 or 0x address.");
  }
  throw new Error('Enter a valid qor1 or 0x recipient address.');
}
type NetworkKey = 'mainnet' | 'testnet';

type WalletNetwork = {
  key: NetworkKey;
  preset: NetworkName;
  name: string;
  shortName: string;
  chainId: string;
  evmChainId: number;
  evmChainHex: string;
  token: string;
  nativeDenom: string;
  decimals: string;
  addressPrefix: string;
  coinType: string;
  minGasPrice: string;
  explorerUrl: string;
  docsUrl: string;
  pqcPolicy: string;
  accountModel: string;
  edgeNote?: string;
  endpoints: {
    rpc: string;
    rest: string;
    grpc: string;
    evmRpc: string;
    svmRpc: string;
    websocket: string;
    evmWs: string;
  };
};

const env = (key: string, fallback: string) => process.env[key] || fallback;

export const qoreNetworks: Record<NetworkKey, WalletNetwork> = {
  mainnet: {
    key: 'mainnet',
    preset: 'mainnet',
    name: 'QoreChain Mainnet',
    shortName: 'Mainnet',
    chainId: 'qorechain-vladi',
    evmChainId: 9801,
    evmChainHex: '0x2649',
    token: 'QOR (uqor)',
    nativeDenom: 'uqor',
    decimals: '6 native / 18 EVM / 9 SVM',
    addressPrefix: 'qor',
    coinType: '118',
    minGasPrice: '0.1uqor',
    explorerUrl: env('EXPO_PUBLIC_QORE_MAINNET_EXPLORER_URL', 'https://explore.qore.network/'),
    docsUrl: 'https://docs.qorechain.io/getting-started/connecting-to-mainnet',
    pqcPolicy: 'Hybrid ML-DSA-87 + secp256k1 signatures enforced by default.',
    accountModel: 'One account and balance across Cosmos, EVM, and SVM address views.',
    edgeNote: 'SVM writes are disabled at the public edge; state changes go through relayed chain transactions.',
    endpoints: {
      rpc: env('EXPO_PUBLIC_QORE_MAINNET_RPC_URL', 'https://rpc.qore.host'),
      rest: env('EXPO_PUBLIC_QORE_MAINNET_REST_URL', 'https://api.qore.host'),
      grpc: env('EXPO_PUBLIC_QORE_MAINNET_GRPC_URL', ''),
      evmRpc: env('EXPO_PUBLIC_QORE_MAINNET_EVM_RPC_URL', 'https://evm.qore.host'),
      svmRpc: env('EXPO_PUBLIC_QORE_MAINNET_SVM_RPC_URL', 'https://svm.qore.host'),
      websocket: env('EXPO_PUBLIC_QORE_MAINNET_WS_URL', 'wss://rpc.qore.host/websocket'),
      evmWs: env('EXPO_PUBLIC_QORE_MAINNET_EVM_WS_URL', ''),
    },
  },
  testnet: {
    key: 'testnet',
    preset: 'testnet',
    name: 'QoreChain Diana Testnet',
    shortName: 'Diana',
    chainId: 'qorechain-diana',
    evmChainId: 9800,
    evmChainHex: '0x2648',
    token: 'QOR (uqor)',
    nativeDenom: 'uqor',
    decimals: '6 native / 18 EVM / 9 SVM',
    addressPrefix: 'qor',
    coinType: '118',
    minGasPrice: '0.1uqor',
    explorerUrl: env('EXPO_PUBLIC_QORE_TESTNET_EXPLORER_URL', 'https://explore.qore.network/'),
    docsUrl: 'https://docs.qorechain.io/getting-started/connecting-to-testnet',
    pqcPolicy: 'Hybrid ML-DSA-87 + secp256k1 signing path available on testnet.',
    accountModel: 'Use Diana for faucet and route testing before mainnet execution.',
    endpoints: {
      rpc: env('EXPO_PUBLIC_QORE_TESTNET_RPC_URL', 'https://rpc-testnet.qore.host'),
      rest: env('EXPO_PUBLIC_QORE_TESTNET_REST_URL', 'https://api-testnet.qore.host'),
      grpc: env('EXPO_PUBLIC_QORE_TESTNET_GRPC_URL', ''),
      evmRpc: env('EXPO_PUBLIC_QORE_TESTNET_EVM_RPC_URL', 'https://evm-testnet.qore.host'),
      svmRpc: env('EXPO_PUBLIC_QORE_TESTNET_SVM_RPC_URL', 'https://svm-testnet.qore.host'),
      websocket: env('EXPO_PUBLIC_QORE_TESTNET_WS_URL', 'wss://rpc-testnet.qore.host/websocket'),
      evmWs: env('EXPO_PUBLIC_QORE_TESTNET_EVM_WS_URL', 'wss://evm-ws-testnet.qore.host'),
    },
  },
};

export const defaultNetworkKey: NetworkKey = process.env.EXPO_PUBLIC_QORE_NETWORK === 'testnet' ? 'testnet' : 'mainnet';
export const networkConfig = qoreNetworks[defaultNetworkKey];

export function resolveNetworkKey(value?: string | null): NetworkKey {
  return value === 'testnet' ? 'testnet' : 'mainnet';
}

export function getNetworkConfig(networkKey?: string | null) {
  return qoreNetworks[resolveNetworkKey(networkKey)];
}

function sdkEndpointOverrides(networkKey?: string | null) {
  const config = getNetworkConfig(networkKey);
  return Object.fromEntries(
    Object.entries({
      rest: config.endpoints.rest,
      grpc: config.endpoints.grpc,
      rpc: config.endpoints.rpc,
      evmRpc: config.endpoints.evmRpc,
      evmWs: config.endpoints.evmWs,
      svmRpc: config.endpoints.svmRpc,
    }).filter(([, value]) => Boolean(value)),
  );
}

export function getRpcStatus(networkKey?: string | null) {
  const config = getNetworkConfig(networkKey);
  return {
    enabled: Boolean(config.endpoints.rpc && config.endpoints.rest),
    label: config.shortName,
    networkKey: config.key,
    rpcUrl: config.endpoints.rpc,
    restUrl: config.endpoints.rest,
    evmRpcUrl: config.endpoints.evmRpc,
    svmRpcUrl: config.endpoints.svmRpc,
  };
}

export const rpcStatus = getRpcStatus(defaultNetworkKey);

// Verified against /cosmos/bank/v1beta1/supply — QOR is currently the only
// on-chain token. New launches (e.g. QUSDT) appear automatically via balance
// auto-discovery or manual import; never list tokens that don't exist yet.
export const defaultTokens = [
  { symbol: 'QOR', name: 'QoreChain', denom: 'uqor', balance: '0', vm: 'Native', decimals: 6, color: '#E8E0C2', tag: 'Native', priceLabel: 'No price', usdValue: '$0.00', addressModes: ['Native', 'EVM', 'SVM'] },
];

export const denomSymbols = { uqor: 'QOR', qusdt: 'QUSDT' };

export function symbolForDenom(denom = '') {
  return denomSymbols[denom] || String(denom).replace(/^u/, '');
}

function metadataDecimals(metadata) {
  const display = metadata?.denom_units?.find((unit) => unit.denom === metadata.display);
  return Number(display?.exponent) || 6;
}

async function fetchNativeMetadata(client, denom) {
  try {
    const response = await client.rest.get(`/cosmos/bank/v1beta1/denoms_metadata/${encodeURIComponent(denom)}`);
    return response?.metadata || null;
  } catch {
    return null;
  }
}
function normalizeAmount(value) {
  const amount = String(value || '0').trim();
  if (!amount || amount === '.') return '0';
  return amount;
}

function hexFromBytes(value): `0x${string}` {
  if (typeof value === 'string') return (value.startsWith('0x') ? value : `0x${value}`) as `0x${string}`;
  return `0x${Array.from(value || []).map((byte: any) => Number(byte).toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}

function txExplorerUrl(config, hash) {
  return hash ? `${config.explorerUrl.replace(/\/$/, '')}/tx/${hash}` : '';
}

function displayNativeBase(amount, exponent = 6) {
  try {
    return fromBase(String(amount || '0'), { exponent });
  } catch {
    return '0';
  }
}

function formatTokenBalance(token, amount) {
  if (token.vm === 'Native') return displayNativeBase(amount, token.decimals || 6);
  try {
    return formatUnits(BigInt(amount || 0), token.decimals || 18);
  } catch {
    return '0';
  }
}

function tokenBalanceFromMap(token, balances) {
  const found = balances.find((coin) => coin.denom === token.denom);
  return found?.amount || '0';
}

function tokenUsdValue(token, balance, qorPriceUsd = null) {
  const numeric = Number.parseFloat(balance || '0');
  if (!Number.isFinite(numeric)) return '$0.00';
  if (token.symbol === 'QUSDT') return formatUsdDisplay(numeric);
  if (token.symbol === 'QOR' && qorPriceUsd) return formatUsdDisplay(numeric * qorPriceUsd);
  return '$0.00';
}

// There is no price oracle in the SDK; the on-chain source of truth is the
// AMM pool itself. Quote 1 QOR -> QUSDT (a $1 stable) and cache for 60s.
// Returns null until a pool with liquidity exists.
const qorPriceCache = new Map();

async function fetchQorPriceUsd(networkKey) {
  const cached = qorPriceCache.get(networkKey);
  if (cached && Date.now() - cached.at < 60_000) return cached.price;
  let price = null;
  try {
    const route = await fetchAmmRouteStatus({ networkKey, denomIn: 'uqor', denomOut: 'qusdt', amountIn: '1' });
    if (route.available) {
      const rawOut = route.quote?.amount_out ?? route.quote?.amountOut;
      // The quote returns micro-QUSDT. Convert the integer amount through the
      // SDK rather than floating-point division so the price cannot silently
      // lose precision when pool liquidity or price scale changes.
      const out = Number.parseFloat(fromBase(String(rawOut ?? '0'), { exponent: 6 }));
      if (Number.isFinite(out) && out > 0) price = out;
    }
  } catch {}
  qorPriceCache.set(networkKey, { price, at: Date.now() });
  // Accrue history whenever a price is observed so the 24h trend has data.
  if (price != null) recordPriceSnapshot(networkKey, price).catch?.(() => {});
  return price;
}

/** Portfolio 24h trend (%) from locally accrued price snapshots; null until
 * both a live pool price and ≥1h of history exist. */
export async function fetchQorChange24h(networkKey = defaultNetworkKey) {
  const price = await fetchQorPriceUsd(networkKey);
  if (price == null) return null;
  return getPriceChange24h(networkKey, price);
}

export function inferRecipientVm(address = '') {
  const clean = String(address || '').trim();
  if (/^qor1/i.test(clean)) return 'Native';
  if (/^0x[0-9a-fA-F]{40}$/.test(clean)) return 'EVM';
  return 'SVM';
}

export async function fetchWalletAssets(wallet, networkKey = defaultNetworkKey) {

  if (!wallet?.accounts) return defaultTokens;

  const config = getNetworkConfig(networkKey);
  const client = createClient({ network: config.preset, endpoints: sdkEndpointOverrides(config.key) });

  let imported = [];
  try {
    imported = await getImportedTokens(config.key);
  } catch {}
  const tokens = [
    ...defaultTokens,
    ...imported.filter((token) => !defaultTokens.some((known) => known.denom === token.denom)),
  ].map((token) => ({ ...token, network: config.shortName, status: 'pending' }));

  let nativeBalances = [];
  let qorPriceUsd = null;
  try {
    const [balancesResponse, price] = await Promise.all([
      client.rest.getAllBalances(wallet.accounts.native.address),
      fetchQorPriceUsd(config.key),
    ]);
    nativeBalances = balancesResponse?.balances || [];
    qorPriceUsd = price;
  } catch (caught) {
    nativeBalances = [];
  }

  const discoveredDenoms = nativeBalances
    .map((coin) => coin?.denom)
    .filter((denom) => denom && !tokens.some((token) => token.denom === denom));
  const metadataEntries = await Promise.all(
    discoveredDenoms.map(async (denom) => [denom, await fetchNativeMetadata(client, denom)] as const),
  );
  const metadataByDenom = new Map(metadataEntries);
  // Auto-discover: any denom the wallet holds but doesn't track yet becomes a
  // token row, so received tokens never need a manual import.
  for (const coin of nativeBalances) {
    if (coin?.denom && !tokens.some((token) => token.denom === coin.denom)) {
      const metadata = metadataByDenom.get(coin.denom);
      tokens.push({
        symbol: metadata?.symbol || symbolForDenom(coin.denom),
        name: metadata?.name || 'QoreChain token',
        denom: coin.denom,
        vm: 'Native',
        decimals: metadataDecimals(metadata),
        tag: 'Native',
        priceLabel: 'No price',
        usdValue: '$0.00',
        addressModes: ['Native'],
        discovered: true,
        network: config.shortName,
        status: 'pending',
      });
    }
  }

  // Imported ERC-20 tokens live on the EVM lane — read balanceOf per token.
  const erc20Balances = new Map();
  const evmTokens = tokens.filter((token) => token.erc20Address);
  if (evmTokens.length && config.endpoints.evmRpc) {
    try {
      const evmClient = await createEvmClient({ rpcUrl: config.endpoints.evmRpc, chainId: config.evmChainId });
      await Promise.all(
        evmTokens.map(async (token) => {
          try {
            const raw = await erc20.balanceOf(evmClient.publicClient, token.erc20Address, wallet.accounts.evm.address);
            erc20Balances.set(token.erc20Address, raw.toString());
          } catch {}
        }),
      );
    } catch {}
  }

  return tokens.map((token) => {
    const raw = token.erc20Address
      ? erc20Balances.get(token.erc20Address) || '0'
      : tokenBalanceFromMap(token, nativeBalances);
    const balance = formatTokenBalance(token, raw);
    const priceLabel =
      token.symbol === 'QOR' && qorPriceUsd
        ? formatUsdPrice(qorPriceUsd)
        : token.priceLabel;
    return {
      ...token,
      rawBalance: raw,
      balance,
      // Comma-grouped display string; `balance` stays raw for math.
      balanceDisplay: formatAmountDisplay(balance),
      priceLabel,
      usdValue: tokenUsdValue(token, balance, qorPriceUsd),
      status: 'live',
    };
  });
}

/**
 * Validate a token identifier against the chain before importing it.
 * - Native denoms: bank metadata gives symbol/name/decimals; supply confirms existence.
 * - 0x addresses: ERC-20 metadata read on the EVM lane.
 */
export async function lookupDenom(denom, networkKey = defaultNetworkKey) {
  const raw = String(denom || '').trim();

  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    const config = getNetworkConfig(networkKey);
    if (!config.endpoints.evmRpc) throw new Error(`${config.shortName} has no EVM endpoint configured.`);
    const evmClient = await createEvmClient({ rpcUrl: config.endpoints.evmRpc, chainId: config.evmChainId });
    try {
      const meta = await erc20.metadata(evmClient.publicClient, raw as any);
      return {
        exists: true,
        kind: 'erc20',
        denom: raw.toLowerCase(),
        erc20Address: raw,
        symbol: meta.symbol || 'TOKEN',
        name: meta.name || 'EVM token',
        decimals: Number(meta.decimals) || 18,
      };
    } catch {
      throw new Error('No ERC-20 token was found at that address on the QoreChain EVM lane.');
    }
  }

  const clean = raw.toLowerCase();
  if (!/^[a-z][a-z0-9/:._-]{1,60}$/.test(clean)) {
    throw new Error('Enter a native denom (e.g. "qusdt") or a 0x ERC-20 contract address.');
  }

  const config = getNetworkConfig(networkKey);
  const client = createClient({ network: config.preset, endpoints: sdkEndpointOverrides(config.key) });

  const metadata = await fetchNativeMetadata(client, clean);

  let supply = null;
  try {
    const response = await client.rest.get('/cosmos/bank/v1beta1/supply/by_denom', { denom: clean });
    supply = response?.amount || null;
  } catch {}

  const exists = Boolean(metadata) || Boolean(supply?.amount && supply.amount !== '0');

  return {
    exists,
    kind: 'native',
    denom: clean,
    symbol: metadata?.symbol || symbolForDenom(clean),
    name: metadata?.name || 'QoreChain token',
    decimals: metadataDecimals(metadata),
  };
}

export async function fetchWalletNfts(wallet, networkKey = defaultNetworkKey) {
  if (!wallet?.accounts) return [];
  const config = getNetworkConfig(networkKey);
  const client = createClient({ network: config.preset, endpoints: sdkEndpointOverrides(config.key) });
  try {
    const response: any = await client.rest.get('/cosmos/nft/v1beta1/nfts', {
      owner: wallet.accounts.native.address,
      'pagination.limit': 50,
    });
    return (response?.nfts || []).map((nft: any) => ({
      classId: nft.class_id,
      id: nft.id,
      uri: nft.uri || '',
      name: `${symbolForDenom(nft.class_id)} #${nft.id}`,
    }));
  } catch {
    return [];
  }
}

export async function submitNftTransfer({ mnemonic, classId, id, toAddress, networkKey = defaultNetworkKey }) {
  if (!mnemonic?.trim()) throw new Error('Create or import a wallet first.');
  const receiver = String(toAddress || '').trim();
  if (!/^qor1[0-9a-z]{10,}$/i.test(receiver)) {
    throw new Error('NFTs transfer between qor1 native addresses. Enter a valid qor1… recipient.');
  }

  const config = getNetworkConfig(networkKey);
  const status = getRpcStatus(networkKey);
  if (!status.enabled) {
    throw new Error('Network connection is unavailable. Try again later.');
  }

  const account = await getUnifiedAccount(mnemonic);
  const message = {
    typeUrl: '/cosmos.nft.v1beta1.MsgSend',
    value: { classId: String(classId), id: String(id), sender: account.cosmos, receiver },
  };
  if (!qorechainRegistry().lookupType(message.typeUrl)) {
    throw new Error('NFT transfers are unavailable until QoreChain adds NFT message support to the SDK.');
  }

  const result = await submitHybridMessages({
    mnemonic,
    messages: [message],
    memo: 'Aegis AI Wallet NFT',
    networkKey: config.key,
  });
  const txHash = result.transactionHash;
  return {
    network: config.shortName,
    txHash,
    quantumSecured: true,
    explorerUrl: txHash ? txExplorerUrl(config, txHash) : '',
  };
}

function transferDetailsFromTx(tx, address) {
  try {
    const message = (tx?.tx?.body?.messages || [])[0] || {};
    const type = String(message['@type'] || '');
    if (type.endsWith('MsgSend')) {
      const outgoing = message.from_address === address;
      const coin = (message.amount || [])[0] || {};
      const symbol = symbolForDenom(coin.denom);
      return {
        kind: outgoing ? 'send' : 'receive',
        // No symbol in the title — the amount column already shows "+100 QOR".
        title: outgoing ? 'Sent' : 'Received',
        symbol,
        amount: displayNativeBase(coin.amount, 6),
        counterparty: outgoing ? message.to_address : message.from_address,
      };
    }
    if (/MsgRegisterPQCKey(?:V2)?$/.test(type)) {
      // Keep the real tx status (don't dress a failed duplicate up as done);
      // failed duplicates are filtered out of the feed entirely below.
      return {
        kind: 'security',
        title: 'Quantum security enabled',
        symbol: 'QOR',
        description: 'Your wallet registered its quantum security key before its first protected transaction. This happens once per wallet.',
      };
    }
    if (type.endsWith('MsgExecuteProgram')) return { kind: 'contract', title: 'SVM transaction', symbol: 'QOR' };
    if (type.endsWith('MsgExecuteContract')) return { kind: 'contract', title: 'Contract call', symbol: 'QOR' };
    if (/MsgEthereumTx/.test(type)) return { kind: 'contract', title: 'EVM transaction', symbol: 'QOR' };
    if (/RegisterAuthenticator/i.test(type)) return { kind: 'security', title: 'Signer linked', symbol: 'QOR' };
    if (/swap/i.test(type)) {
      const coin = message.token_in || {};
      return {
        kind: 'swap',
        title: 'Swap',
        symbol: symbolForDenom(coin.denom),
        amount: coin.amount ? displayNativeBase(coin.amount, 6) : '',
      };
    }
  } catch {}
  return {};
}

function parseTxResponses(response, config, source, address) {
  return (response?.tx_responses || []).map((tx) => ({
    hash: tx.txhash,
    title: source,
    // Plain "Failed" in lists — "(7)" reads like a count; the numeric code
    // is carried separately for the detail screen.
    status: Number(tx.code || 0) === 0 ? 'Success' : 'Failed',
    errorCode: Number(tx.code || 0) !== 0 ? String(tx.code) : '',
    height: tx.height,
    timestamp: tx.timestamp,
    explorerUrl: txExplorerUrl(config, tx.txhash),
    ...transferDetailsFromTx(tx, address),
  }));
}

// Cosmos SDK 0.50+ expects `query`; older REST edges still want `events`.
async function queryNativeTxs(client, filter) {
  try {
    return await client.rest.get('/cosmos/tx/v1beta1/txs', {
      query: filter,
      order_by: 'ORDER_BY_DESC',
      'pagination.limit': 10,
    });
  } catch (caught) {
    return client.rest.get('/cosmos/tx/v1beta1/txs', {
      events: filter,
      order_by: 'ORDER_BY_DESC',
      'pagination.limit': 10,
    });
  }
}

export async function fetchWalletActivity(wallet, networkKey = defaultNetworkKey) {
  if (!wallet?.accounts) return [];

  const config = getNetworkConfig(networkKey);
  const client = createClient({ network: config.preset, endpoints: sdkEndpointOverrides(config.key) });
  const address = wallet.accounts.native.address;
  const rows = [];

  try {
    const sent = await queryNativeTxs(client, `message.sender='${address}'`);
    rows.push(...parseTxResponses(sent, config, 'Transaction', address));
  } catch (caught) {}

  try {
    const received = await queryNativeTxs(client, `transfer.recipient='${address}'`);
    rows.push(...parseTxResponses(received, config, 'Transaction', address));
  } catch (caught) {}

  try {
    const svmClient = createSvmClient({ endpoints: { svmRpc: config.endpoints.svmRpc } });
    const signatures = await svmClient.getSignaturesForAddress(new PublicKey(wallet.accounts.svm.address), { limit: 5 });
    rows.push(...(signatures || []).map((entry) => ({
      hash: entry.signature,
      title: 'SVM transaction',
      status: entry.err ? 'Failed' : 'Confirmed',
      height: entry.slot,
      timestamp: entry.blockTime ? new Date(entry.blockTime * 1000).toISOString() : '',
      explorerUrl: txExplorerUrl(config, entry.signature),
    })));
  } catch (caught) {}


  // Merge locally-tracked sends (pending / failed / just-confirmed) so they
  // always appear — even before, or when they never reach, on-chain history.
  // Pushed AFTER the on-chain rows so a confirmed on-chain entry wins the
  // dedup for a matching hash; failed/pending locals keep their own row.
  try {
    const local = await getLocalTxs(networkKey, address);
    rows.push(
      ...local.map((entry) => ({
        hash: entry.hash || entry.id,
        title: entry.title || 'Transaction',
        errorCode: entry.errorCode || '',
        status: entry.status || 'Pending',
        kind: entry.kind,
        symbol: entry.symbol,
        amount: entry.amount,
        counterparty: entry.counterparty,
        explorerUrl: entry.explorerUrl || (entry.hash ? txExplorerUrl(config, entry.hash) : ''),
        height: '',
        timestamp: new Date(entry.at || Date.now()).toISOString(),
      })),
    );
  } catch (caught) {}

  const seen = new Set();
  const unique = rows.filter((row) => {
    if (!row.hash || seen.has(row.hash)) return false;
    seen.add(row.hash);
    // Failed duplicate key registrations are protocol noise (the key was
    // already registered) — confusing in a user's history, so drop them.
    if (row.kind === 'security' && /fail/i.test(row.status || '')) return false;
    return true;
  });
  unique.sort((a, b) => {
    if (a.timestamp && b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
    return Number(b.height || 0) - Number(a.height || 0);
  });
  return unique.slice(0, 12);
}

export async function fetchAmmRouteStatus({ networkKey = defaultNetworkKey, poolId = '1', denomIn = 'uqor', denomOut = 'uusdc', amountIn = '0', amountOut = '0', mode = 'exact-in' } = {}) {
  const config = getNetworkConfig(networkKey);
  const client = createClient({ network: config.preset, endpoints: sdkEndpointOverrides(config.key) });
  const normalizedPoolId = String(poolId || '1');
  const baseAmountIn = toBase(normalizeAmount(amountIn));

  try {
    const params: any = await client.rest.get('/qorechain/amm/v1/params');
    if (params?.params?.enabled === false) {
      return {
        available: false,
        poolId: normalizedPoolId,
        denomIn,
        denomOut,
        source: '/qorechain/amm/v1/params',
        detail: 'Swaps are not available on this network yet.',
        params,
      };
    }
  } catch (caught) {}

  let resolvedPoolId = normalizedPoolId;
  try {
    const pools: any = await client.rest.get('/qorechain/amm/v1/pools');
    const list = pools?.pools || [];
    if (Array.isArray(list) && list.length === 0) {
      return {
        available: false,
        poolId: resolvedPoolId,
        denomIn,
        denomOut,
        source: '/qorechain/amm/v1/pools',
        detail: 'This pair is not available yet. Swaps will turn on automatically when it is ready.',
        pools: list,
      };
    }
    // Resolve the pool that actually holds this pair (schema-agnostic match on
    // the pool's denom strings) instead of assuming pool 1.
    if (Array.isArray(list)) {
      const matched = list.find((pool) => {
        const blob = JSON.stringify(pool || {});
        return blob.includes(`"${denomIn}"`) && blob.includes(`"${denomOut}"`);
      });
      if (matched) resolvedPoolId = String(matched.id ?? matched.pool_id ?? resolvedPoolId);
    }
  } catch (caught) {}

  const quotePath = mode === 'exact-out'
    ? `/qorechain/amm/v1/quote_exact_out/${encodeURIComponent(resolvedPoolId)}/${encodeURIComponent(denomOut)}/${encodeURIComponent(toBase(normalizeAmount(amountOut || amountIn)))}`
    : `/qorechain/amm/v1/quote_exact_in/${encodeURIComponent(resolvedPoolId)}/${encodeURIComponent(denomIn)}/${encodeURIComponent(baseAmountIn)}`;

  try {
    const quote: any = await client.rest.get(quotePath);
    return {
      available: true,
      poolId: resolvedPoolId,
      denomIn,
      denomOut,
      source: quotePath,
      detail: 'Quote endpoint responded. Use amount_out/fee to set minimum output before signing.',
      quote,
    };
  } catch (caught) {
    return {
      available: false,
      poolId: resolvedPoolId,
      denomIn,
      denomOut,
      source: quotePath,
      detail: 'A price is not available for this amount right now. Try again later or enter a different amount.',
      error: caught?.message || String(caught),
    };
  }
}
export function shortAddress(address, head = 8, tail = 6) {
  if (!address) return 'Not derived';
  if (address.length <= head + tail + 3) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

// â”€â”€ Backend auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The backend requires proof of address ownership: an EIP-191 signature over
// "AEGIS Auth v1\n{address}\n{timestamp}" made with the wallet's EVM key.
// Only the signature travels — no key material ever leaves the device.
let cachedAuthAccount: { mnemonic: string; account: any } | null = null;

// Single-flight: key derivation (PBKDF2) blocks the JS thread for ~1s, so
// concurrent callers must share one in-flight derivation instead of each
// missing the cache and deriving again.
let pendingAuthAccount: { mnemonic: string; promise: Promise<any> } | null = null;

async function getEvmViemAccount(mnemonic) {
  if (cachedAuthAccount?.mnemonic === mnemonic) return cachedAuthAccount.account;
  if (pendingAuthAccount?.mnemonic === mnemonic) return pendingAuthAccount.promise;
  const promise = (async () => {
    const derived = await deriveEvmAccount(mnemonic);
    const { privateKeyToAccount } = await import('viem/accounts');
    cachedAuthAccount = { mnemonic, account: privateKeyToAccount(hexFromBytes(derived.privateKey)) };
    return cachedAuthAccount.account;
  })();
  pendingAuthAccount = { mnemonic, promise };
  try {
    return await promise;
  } finally {
    pendingAuthAccount = null;
  }
}

// Pre-derive the auth signing key off the critical path (fire-and-forget
// after unlock) so the first authed request doesn't stall the UI.
export function warmAuthAccount(mnemonic) {
  return getEvmViemAccount(mnemonic).catch(() => {});
}

export async function getAuthHeaders(mnemonic) {
  await getEvmViemAccount(mnemonic);
  const address = cachedAuthAccount.account.address.toLowerCase();
  const timestamp = String(Date.now());
  const signature = await cachedAuthAccount.account.signMessage({
    message: `AEGIS Auth v1\n${address}\n${timestamp}`,
  });
  return {
    'x-aegis-address': address,
    'x-aegis-timestamp': timestamp,
    'x-aegis-signature': signature,
  };
}

// â”€â”€ Dapp browser (EIP-1193 bridge) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The dapp browser injects a MetaMask-compatible provider; these helpers do
// the native-side work. QoreChain's EVM lane is PQC-exempt, so standard EVM
// signing is exactly what the chain expects for dapp interactions.

export async function dappSignMessage(mnemonic, data) {
  const account = await getEvmViemAccount(mnemonic);
  const message =
    typeof data === 'string' && data.startsWith('0x') ? { raw: data } : String(data ?? '');
  return account.signMessage({ message });
}

export async function dappSignRawHash(mnemonic, hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash))) {
    const error: any = new Error('eth_sign requires a 32-byte 0x-prefixed hash.');
    error.code = 4200;
    throw error;
  }
  const account = await getEvmViemAccount(mnemonic);
  return account.sign({ hash: hash as `0x${string}` });
}

export async function dappSignTypedData(mnemonic, typedDataJson) {
  const account = await getEvmViemAccount(mnemonic);
  const typed = typeof typedDataJson === 'string' ? JSON.parse(typedDataJson) : typedDataJson;
  return account.signTypedData(typed);
}

export async function dappSendTransaction(mnemonic, tx, networkKey = defaultNetworkKey) {
  const config = getNetworkConfig(networkKey);
  if (!config.endpoints.evmRpc) throw new Error(`${config.shortName} EVM JSON-RPC endpoint is unavailable.`);
  const account = await getEvmViemAccount(mnemonic);
  const evmClient = await createEvmClient({ rpcUrl: config.endpoints.evmRpc, chainId: config.evmChainId });
  const walletClient = evmClient.getWalletClient(account);
  const request: any = { account, chain: evmClient.chain, to: tx.to ? toEvmAddress(tx.to) : tx.to };
  if (tx.value) request.value = BigInt(tx.value);
  if (tx.data && tx.data !== '0x') request.data = tx.data;
  if (tx.gas) request.gas = BigInt(tx.gas);
  if (tx.nonce !== undefined) request.nonce = Number(tx.nonce);
  if (tx.maxFeePerGas) request.maxFeePerGas = BigInt(tx.maxFeePerGas);
  if (tx.maxPriorityFeePerGas) request.maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas);
  return (walletClient as any).sendTransaction(request);
}

// eth_signTransaction: sign but do NOT broadcast — returns the raw signed tx
// hex. Missing fields (nonce/gas/fees/chainId) are filled from the network.
export async function dappSignTransaction(mnemonic, tx, networkKey = defaultNetworkKey) {
  const config = getNetworkConfig(networkKey);
  if (!config.endpoints.evmRpc) throw new Error(`${config.shortName} EVM JSON-RPC endpoint is unavailable.`);
  const account = await getEvmViemAccount(mnemonic);
  const evmClient = await createEvmClient({ rpcUrl: config.endpoints.evmRpc, chainId: config.evmChainId });
  const walletClient = evmClient.getWalletClient(account);
  const request: any = { account, chain: evmClient.chain, to: tx.to ? toEvmAddress(tx.to) : tx.to };
  if (tx.value) request.value = BigInt(tx.value);
  if (tx.data && tx.data !== '0x') request.data = tx.data;
  if (tx.gas) request.gas = BigInt(tx.gas);
  if (tx.nonce !== undefined) request.nonce = Number(tx.nonce);
  if (tx.maxFeePerGas) request.maxFeePerGas = BigInt(tx.maxFeePerGas);
  if (tx.maxPriorityFeePerGas) request.maxPriorityFeePerGas = BigInt(tx.maxPriorityFeePerGas);
  const prepared = await (walletClient as any).prepareTransactionRequest(request);
  return (walletClient as any).signTransaction(prepared);
}

const bytesToB64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const b64ToBytes = (b64) => {
  const binary = atob(String(b64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

// â”€â”€ Cosmos (Keplr-compatible) dapp handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// QoreChain dapps use @qorechain/connect / wallet-adapter, which bakes the
// ML-DSA-87 extension into the tx body BEFORE calling the wallet's standard
// signDirect — so behaving exactly like Keplr here is the protocol-correct
// wallet role; the quantum layer is applied dapp-side per the SDK's design.

export async function dappCosmosGetKey(mnemonic, networkKey = defaultNetworkKey) {
  const unified = await getUnifiedAccount(mnemonic);
  return {
    name: 'AEGIS Wallet',
    algo: 'secp256k1',
    bech32Address: unified.cosmos,
    pubKeyB64: bytesToB64(bytesFromHex(unified.publicKey)),
  };
}

export async function dappCosmosExecuteContract(mnemonic, networkKey, request) {
  const config = getNetworkConfig(networkKey);
  if (request?.chainId && request.chainId !== config.chainId) {
    throw new Error(`AEGIS is connected to ${config.chainId}; the dapp requested ${request.chainId}.`);
  }
  const unified = await getUnifiedAccount(mnemonic);
  const contract = String(request?.contract || '').trim();
  const msg = request?.message;
  if (!isValidBech32(contract, 'qor')) throw new Error('The contract address is invalid.');
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('The contract message is invalid.');
  const funds = Array.isArray(request?.funds) ? request.funds.map((coin) => {
    const denom = String(coin?.denom || '');
    const amount = String(coin?.amount || '');
    if (!/^[a-z][a-z0-9/._-]{1,127}$/.test(denom) || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      throw new Error('The contract funds are invalid.');
    }
    return { denom, amount };
  }) : [];
  if (funds.length > 8) throw new Error('Too many contract funds were requested.');
  const result = await submitHybridMessages({
    mnemonic,
    networkKey,
    memo: String(request?.memo || 'Aegis dapp contract call').slice(0, 256),
    gasFloor: 800000,
    registryTypes: [['/cosmwasm.wasm.v1.MsgExecuteContract', MsgExecuteContract]],
    messages: [{
      typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
      value: MsgExecuteContract.fromPartial({
        sender: unified.cosmos,
        contract,
        msg: new TextEncoder().encode(JSON.stringify(msg)),
        funds,
      }),
    }],
  });
  return result.transactionHash;
}

export async function dappCosmosSignDirect(mnemonic, networkKey, { signerAddress, bodyB64, authB64, chainId, accountNumber }) {
  const config = getNetworkConfig(networkKey);
  if (chainId && chainId !== config.chainId) {
    throw new Error(`AEGIS is connected to ${config.chainId}; the dapp requested ${chainId}.`);
  }
  const unified = await getUnifiedAccount(mnemonic);
  if (signerAddress && signerAddress !== unified.cosmos) {
    throw new Error('The requested Native signer does not match this wallet.');
  }

  // Convert a normal Keplr/CosmJS request to QoreChain's eth-native hybrid form
  // so dapps do not need any Aegis-specific transaction integration.
  const incomingBody = TxBody.decode(b64ToBytes(bodyB64));
  const baseBody = TxBody.fromPartial({
    messages: incomingBody.messages,
    memo: incomingBody.memo,
    timeoutHeight: incomingBody.timeoutHeight,
    extensionOptions: incomingBody.extensionOptions.filter((option) => option.typeUrl !== HYBRID_SIG_TYPE_URL),
    nonCriticalExtensionOptions: incomingBody.nonCriticalExtensionOptions,
  });
  const b0 = TxBody.encode(baseBody).finish();
  const authInfo = AuthInfo.decode(b64ToBytes(authB64));
  if (authInfo.signerInfos.length !== 1) throw new Error('AEGIS supports one Native signer per transaction.');
  authInfo.signerInfos[0].publicKey = {
    typeUrl: ETHSECP256K1_PUBKEY_TYPE,
    value: PubKey.encode(PubKey.fromPartial({ key: bytesFromHex(unified.publicKey) })).finish(),
  };
  const canonicalAuthInfo = AuthInfo.encode(authInfo).finish();
  const framed = new Uint8Array(8 + b0.length + canonicalAuthInfo.length);
  const view = new DataView(framed.buffer);
  view.setUint32(0, b0.length);
  framed.set(b0, 4);
  view.setUint32(4 + b0.length, canonicalAuthInfo.length);
  framed.set(canonicalAuthInfo, 8 + b0.length);
  // Standard Keplr dapps do not send a separate key-registration message.
  // Carry the key in the first hybrid signature so QoreChain auto-registers it
  // atomically with the protected dapp transaction.
  const hybrid = encodeHybridExtension(buildHybridSignatureExtension({
    algorithmId: AlgorithmDilithium5,
    signature: pqcSign(unified.pqc.secretKey, framed),
    publicKey: unified.pqc.publicKey,
  }));
  const finalBody = TxBody.encode(TxBody.fromPartial({
    messages: baseBody.messages,
    memo: baseBody.memo,
    timeoutHeight: baseBody.timeoutHeight,
    extensionOptions: [...baseBody.extensionOptions, hybrid],
    nonCriticalExtensionOptions: baseBody.nonCriticalExtensionOptions,
  })).finish();
  const resolvedChainId = chainId || config.chainId;
  const acctNumber = BigInt(String(accountNumber ?? '0'));
  const signDocBytes = SignDoc.encode(SignDoc.fromPartial({ bodyBytes: finalBody, authInfoBytes: canonicalAuthInfo, chainId: resolvedChainId, accountNumber: acctNumber })).finish();
  const signature = secp256k1.sign(keccak256(signDocBytes), bytesFromHex(unified.privateKey)).toCompactRawBytes();
  return {
    signed: { bodyB64: bytesToB64(finalBody), authB64: bytesToB64(canonicalAuthInfo), chainId: resolvedChainId, accountNumber: String(acctNumber) },
    signature: { pub_key: { type: ETHSECP256K1_PUBKEY_TYPE, value: bytesToB64(bytesFromHex(unified.publicKey)) }, signature: bytesToB64(signature) },
  };
}
export async function dappCosmosSignArbitrary(mnemonic, networkKey, { chainId, signerAddress, data, dataB64 }) {
  const config = getNetworkConfig(networkKey);
  if (chainId && chainId !== config.chainId) {
    throw new Error(`AEGIS is connected to ${config.chainId}; the dapp requested ${chainId}.`);
  }
  const unified = await getUnifiedAccount(mnemonic);
  if (signerAddress && signerAddress !== unified.cosmos) {
    throw new Error('The requested Native signer does not match this wallet.');
  }
  const messageBytes = dataB64 ? b64ToBytes(dataB64) : new TextEncoder().encode(String(data || ''));
  const signDoc = {
    account_number: '0',
    chain_id: '',
    fee: { amount: [], gas: '0' },
    memo: '',
    msgs: [{
      type: 'sign/MsgSignData',
      value: { data: bytesToB64(messageBytes), signer: unified.cosmos },
    }],
    sequence: '0',
  };
  // This is the canonical Amino JSON layout emitted by CosmJS serializeSignDoc.
  const signBytes = new TextEncoder().encode(JSON.stringify(signDoc));
  const signature = secp256k1.sign(keccak256(signBytes), bytesFromHex(unified.privateKey)).toCompactRawBytes();
  return {
    signature: bytesToB64(signature),
    pub_key: { type: ETHSECP256K1_PUBKEY_TYPE, value: bytesToB64(bytesFromHex(unified.publicKey)) },
  };
}

export async function dappCosmosBroadcast(txB64, networkKey = defaultNetworkKey) {
  const config = getNetworkConfig(networkKey);
  const result = await hybridTransport(config).broadcastTx(b64ToBytes(txB64));
  if (result.code !== 0) throw new Error(result.rawLog || `Transaction failed (code ${result.code}).`);
  return result.transactionHash;
}

// â”€â”€ SVM (Phantom-compatible) dapp handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Public SVM RPC is read-only on QoreChain; SVM writes execute via
// MsgExecuteProgram on the cosmos lane. With no `auth` field the Cosmos
// sender's canonical account IS the effective SVM signer — AEGIS holds the
// primary key, so no authenticator/relayer is needed (verified live on Diana).

function svmSignOnlyUnavailable(): never {
  const error: any = new Error('AEGIS executes QoreChain SVM actions through signAndSendTransaction; sign-only operations are not available yet.');
  error.code = 4200;
  throw error;
}

export async function dappSvmSignMessage(_mnemonic, _messageB64) {
  return svmSignOnlyUnavailable();
}

export async function dappSvmSignTransaction(_mnemonic, _txB64, _versioned = false) {
  return svmSignOnlyUnavailable();
}

/** Decode a serialized Solana transaction into MsgExecuteProgram messages. */
async function svmMessagesFromTxBytes(sender, txB64, versioned) {
  const { Transaction, VersionedTransaction } = await import('@solana/web3.js');
  const bytes = b64ToBytes(txB64);
  let instructions;
  try {
    if (versioned) {
      const tx = VersionedTransaction.deserialize(bytes);
      const message = tx.message;
      const keys = message.staticAccountKeys;
      if (message.addressTableLookups?.length) throw new Error('Address-table lookups are not supported on the QoreChain SVM relay yet.');
      instructions = message.compiledInstructions.map((ix) => ({
        programId: keys[ix.programIdIndex].toBytes(),
        keys: ix.accountKeyIndexes.map((index) => ({ address: keys[index].toBytes(), isSigner: message.isAccountSigner(index), isWritable: message.isAccountWritable(index) })),
        data: ix.data,
      }));
    } else {
      const tx = Transaction.from(bytes);
      instructions = tx.instructions.map((ix) => ({
        programId: ix.programId.toBytes(),
        keys: ix.keys.map((key) => ({ address: key.pubkey.toBytes(), isSigner: key.isSigner, isWritable: key.isWritable })),
        data: new Uint8Array(ix.data),
      }));
    }
  } catch (caught: any) {
    throw new Error(caught?.message || 'That input is not a valid serialized SVM transaction.');
  }
  return instructions.map((ix) => qoreMsg.svm.executeProgram({
    sender,
    programId: ix.programId,
    accounts: ix.keys.map((key) => ({ address: key.address, isSigner: key.isSigner, isWritable: key.isWritable })),
    data: ix.data,
  }));
}

/** Phantom-style signAndSendTransaction: relay the tx's instructions on-chain
 * (atomic — one tx body) with the hybrid PQC signature. Returns the hash. */
export async function dappSvmSignAndSend(mnemonic, txB64, versioned = false, networkKey = defaultNetworkKey) {
  const account = await getUnifiedAccount(mnemonic);
  const messages = await svmMessagesFromTxBytes(account.cosmos, txB64, versioned);
  if (!messages.length) throw new Error('The SVM transaction contains no instructions.');
  const result = await submitHybridMessages({
    mnemonic,
    messages,
    memo: 'Aegis SVM relay',
    networkKey,
    gasFloor: 900000,
  });
  return result.transactionHash;
}

/** Read-only JSON-RPC passthrough for the injected provider. */
export async function dappRpcRequest(method, params = [], networkKey = defaultNetworkKey) {
  const config = getNetworkConfig(networkKey);
  if (!config.endpoints.evmRpc) throw new Error('EVM endpoint unavailable.');
  const response = await fetch(config.endpoints.evmRpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await response.json();
  if (data.error) {
    const error: any = new Error(data.error.message || 'RPC error');
    error.code = data.error.code;
    throw error;
  }
  return data.result;
}

export async function createWallet() {
  return restoreWallet(generateMnemonic(128));
}

export async function restoreWallet(rawMnemonic) {
  const mnemonic = rawMnemonic.trim().replace(/\s+/g, ' ').toLowerCase();
  if (mnemonic.split(' ').length < 12) {
    throw new Error('Enter a valid 12 or 24 word recovery phrase.');
  }

  // QoreChain Wallet exposes one canonical three-rail account. Its SVM view
  // is the SDK's padded unified address, not the unrelated Solana HD account.
  const unified = await getUnifiedAccount(mnemonic);

  return {
    mnemonic,
    accounts: {
      native: { label: 'Native', address: unified.cosmos },
      evm: { label: 'EVM', address: unified.evm },
      svm: { label: 'SVM', address: unified.svm },
    },
    createdAt: new Date().toISOString(),
  };
}

export function getNetworkSummary(networkKey?: string | null) {
  const config = getNetworkConfig(networkKey);
  const preset = getNetwork(config.preset);
  const overrides = sdkEndpointOverrides(config.key);
  const client = createClient({ network: config.preset, endpoints: overrides });
  const endpoints = { ...preset.endpoints, ...overrides };
  const svmClient = createSvmClient({ endpoints });
  return {
    chainId: client.network.chainId,
    evmChainId: config.evmChainId,
    evmChainHex: config.evmChainHex,
    displayCoin: client.network.coin.display,
    baseCoin: client.network.coin.base,
    endpoints,
    websocket: config.endpoints.websocket,
    svmRpc: svmClient.connection.rpcEndpoint,
    evmBridge: PRECOMPILE_ADDRESSES.crossVmBridge,
  };
}

export function composeNativeTransfer({ fromAddress, toAddress, amount = '0', denom = 'uqor', decimals = 6, memo = '', networkKey = defaultNetworkKey }) {
  if (!fromAddress) throw new Error('Create or import a wallet first.');
  if (!toAddress?.trim()) throw new Error('Recipient address is required.');

  return {
    kind: 'Native transfer',
    broadcastEnabled: getRpcStatus(networkKey).enabled,
    rpcStatus: getRpcStatus(networkKey),
    memo,
    message: bank.send({
      fromAddress,
      toAddress: toNativeAddress(toAddress),
      amount: [{ denom, amount: parseUnits(normalizeAmount(amount), decimals).toString() }],
    }),
  };
}

// â”€â”€ Quantum-secured (hybrid ML-DSA-87 + secp256k1) signing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// QoreChain requires hybrid signatures on cosmos transactions
// (hybrid_signature_mode = required). Every native broadcast below goes
// through the SDK's hybrid path: register the PQC key once (idempotent,
// registration messages are classical-exempt), then sign each tx with BOTH
// the classical key and the ML-DSA-87 key via signAndBroadcastHybrid.

// Canonical unified account: one eth_secp256k1 key supplies the qor1 and 0x
// views of the same 20-byte identity plus its deterministic ML-DSA-87 keypair.
// SVM uses the SDK's separate Ed25519 derivation. Cached because derivation is
// CPU-heavy.
const unifiedAccountCache = new Map<string, any>();

async function getUnifiedAccount(mnemonic) {
  let account = unifiedAccountCache.get(mnemonic);
  if (!account) {
    account = await deriveUnifiedAccount(mnemonic);
    unifiedAccountCache.set(mnemonic, account);
  }
  return account;
}

const bytesFromHex = (hex) => {
  const clean = String(hex || '').replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const pqcRegisteredAddresses = new Set();

async function fetchAccountMeta(config, address) {
  const response = await fetch(`${config.endpoints.rest.replace(/\/$/, '')}/cosmos/auth/v1beta1/accounts/${address}`);
  if (!response.ok) {
    throw new Error('This account is not on-chain yet. It needs to hold QOR before it can transact.');
  }
  const data = await response.json();
  const account = data?.account?.base_account || data?.account?.base_vesting_account?.base_account || data?.account;
  return {
    accountNumber: BigInt(account?.account_number ?? 0),
    sequence: BigInt(account?.sequence ?? 0),
  };
}

// Minimal HybridBroadcaster over the standard Cosmos REST tx endpoints.
function hybridTransport(config) {
  const restBase = config.endpoints.rest.replace(/\/$/, '');
  const toBase64 = (bytes) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };
  const broadcastTxSync = async (txBytes) => {
    const response = await fetch(`${restBase}/cosmos/tx/v1beta1/txs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_bytes: toBase64(txBytes), mode: 'BROADCAST_MODE_SYNC' }),
    });
    const data = await response.json();
    const txResponse = data?.tx_response;
    if (!txResponse?.txhash) throw new Error(data?.message || 'Broadcast failed.');
    if (Number(txResponse.code || 0) !== 0) {
      throw new Error(txResponse.raw_log || `Broadcast rejected (code ${txResponse.code}).`);
    }
    return txResponse.txhash;
  };
  return {
    broadcastTxSync,
    broadcastTx: async (txBytes, timeoutMs = 45000, pollIntervalMs = 1500) => {
      const hash = await broadcastTxSync(txBytes);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        try {
          const response = await fetch(`${restBase}/cosmos/tx/v1beta1/txs/${hash}`);
          if (response.ok) {
            const data = await response.json();
            const txResponse = data?.tx_response;
            if (txResponse) {
              return {
                code: Number(txResponse.code || 0),
                transactionHash: hash,
                height: Number(txResponse.height || 0),
                rawLog: txResponse.raw_log,
              };
            }
          }
        } catch {}
      }
      throw new Error(`Transaction ${hash} was not confirmed within ${Math.round(timeoutMs / 1000)}s.`);
    },
  };
}

/**
 * Sign and broadcast native (cosmos) messages from the UNIFIED eth-native
 * account, with the mandatory hybrid ML-DSA-87 signature.
 *
 * Uses the SDK's `EthNativeSigner` (keccak address + eth_secp256k1 pubkey +
 * PQC), NOT cosmjs's `DirectSecp256k1Wallet` — that was the coin-118 signer,
 * which produced a DIFFERENT (ripemd160) cosmos account. The account's own PQC
 * keypair is carried by the unified account, and the chain requires it be
 * registered before the first hybrid tx (the registration message itself is
 * classical-exempt, so it bootstraps without a PQC signature).
 */
async function submitHybridMessages({ mnemonic, messages, memo = 'Aegis AI Wallet', networkKey = defaultNetworkKey, gasFloor = 700000, registryTypes = [] }) {
  const config = getNetworkConfig(networkKey);
  const unified = await getUnifiedAccount(mnemonic);
  const transport = hybridTransport(config);
  const registry = qorechainRegistry();
  for (const [typeUrl, type] of registryTypes) registry.register(typeUrl, type);
  const gasPrice = Number.parseFloat(config.minGasPrice) || 0.1;
  const feeFor = (gas = gasFloor) => ({
    // Diana currently rejects fees below 100,000 uqor regardless of gas
    // limit. Keep app-originated transfers and contract calls above it.
    amount: [{ denom: 'uqor', amount: String(Math.max(100000, Math.ceil(gas * gasPrice))) }],
    gas: String(gas),
  });

  // One-time PQC key registration (classical-exempt bootstrap). We broadcast
  // MsgRegisterPQCKeyV2 signed classically; if the key is already registered the
  // chain rejects it, which we treat as done. Registration is per address PER
  // CHAIN; the flag is persisted because a duplicate attempt is included
  // on-chain as a failed tx and still burns its fee (~0.1 QOR) — without
  // persistence every app launch would waste that on its first transaction.
  const pqcKey = `${config.key}.${unified.cosmos}`;
  if (!pqcRegisteredAddresses.has(pqcKey) && await isPqcRegistered(config.key, unified.cosmos)) {
    pqcRegisteredAddresses.add(pqcKey);
  }
  // A wallet restored on a new device has no local flag but may already be
  // registered on-chain. Hybrid signatures are mandatory, so ANY successful
  // past tx from this address proves the key is registered — one free history
  // read instead of a duplicate registration that burns its fee as Failed(7).
  if (!pqcRegisteredAddresses.has(pqcKey)) {
    try {
      const restBase = config.endpoints.rest.replace(/\/$/, '');
      const filter = encodeURIComponent(`message.sender='${unified.cosmos}'`);
      let data: any = null;
      // Cosmos SDK 0.50+ expects `query`; older REST edges still want `events`.
      for (const param of ['query', 'events']) {
        const response = await fetch(`${restBase}/cosmos/tx/v1beta1/txs?${param}=${filter}&pagination.limit=10`);
        if (response.ok) { data = await response.json(); break; }
      }
      if ((data?.tx_responses || []).some((tx) => Number(tx.code || 0) === 0)) {
        pqcRegisteredAddresses.add(pqcKey);
        markPqcRegistered(config.key, unified.cosmos).catch(() => {});
      }
    } catch {}
  }
  if (!pqcRegisteredAddresses.has(pqcKey)) {
    try {
      const registerMsg = buildRegisterPqcKeyMsg(unified.cosmos, {
        pqcKeypair: unified.pqc,
        ecdsaPubkey: bytesFromHex(unified.publicKey),
        keyType: 'hybrid',
      });
      const classicalSigner = new EthNativeSigner(unified, { registry, signMode: 'classical' });
      const meta = await fetchAccountMeta(config, unified.cosmos);
      const result = await classicalSigner.signAndBroadcast(transport, {
        chainId: config.chainId,
        messages: [registerMsg],
        fee: feeFor(),
        accountNumber: meta.accountNumber,
        sequence: meta.sequence,
        memo: 'Register quantum key',
      });
      // Delivered code 0 = registered now; a duplicate attempt is delivered
      // with a non-zero code whose log says the key already exists — both
      // mean this address is registered on this chain.
      if (Number(result.code || 0) === 0 || /already registered|already exists|duplicate|key exists|pqc key/i.test(String(result.rawLog || ''))) {
        pqcRegisteredAddresses.add(pqcKey);
        markPqcRegistered(config.key, unified.cosmos).catch(() => {});
      }
    } catch (caught: any) {
      const message = String(caught?.message || caught || '');
      if (/already registered|already exists|duplicate|key exists|pqc key/i.test(message)) {
        pqcRegisteredAddresses.add(pqcKey);
        markPqcRegistered(config.key, unified.cosmos).catch(() => {});
      } else {
        throw caught;
      }
    }
  }

  // Sign + broadcast the actual messages with the hybrid (ML-DSA-87) signature.
  const signer = new EthNativeSigner(unified, { registry, signMode: 'hybrid' });
  const { accountNumber, sequence } = await fetchAccountMeta(config, unified.cosmos);
  const result = await signer.signAndBroadcast(transport, {
    chainId: config.chainId,
    messages,
    fee: feeFor(),
    accountNumber,
    sequence,
    memo,
  });
  if (Number(result.code || 0) !== 0) {
    throw new Error(result.rawLog || `Transaction failed (code ${result.code}).`);
  }
  return result;
}

export async function submitNativeTransfer({ mnemonic, toAddress, amount = '0', denom = 'uqor', decimals = 6, memo = 'Aegis AI Wallet', networkKey = defaultNetworkKey }) {
  if (!mnemonic?.trim()) throw new Error('Create or import a wallet first.');

  const config = getNetworkConfig(networkKey);
  const status = getRpcStatus(networkKey);
  if (!status.enabled) {
    throw new Error(`${config.shortName} RPC and REST endpoints are required before broadcasting.`);
  }

  const account = await getUnifiedAccount(mnemonic);
  const preview = composeNativeTransfer({
    fromAddress: account.cosmos,
    toAddress,
    amount,
    denom,
    decimals,
    memo,
    networkKey: config.key,
  });

  const result = await submitHybridMessages({
    mnemonic,
    messages: [preview.message],
    memo: preview.memo,
    networkKey: config.key,
  });
  const txHash = result.transactionHash;

  return {
    kind: preview.kind,
    network: config.shortName,
    message: preview.message,
    result,
    txHash,
    quantumSecured: true,
    explorerUrl: txHash ? `${config.explorerUrl.replace(/\/$/, '')}/tx/${txHash}` : '',
  };
}

export function composeTokenTransfer({ wallet, token, toAddress, amount = '0', networkKey = defaultNetworkKey }) {
  if (!wallet?.accounts) throw new Error('Create or import a wallet first.');
  if (!toAddress?.trim()) throw new Error('Recipient address is required.');

  // Imported ERC-20 tokens transfer on the EVM lane via the token contract.
  if (token?.erc20Address) {
    return {
      kind: 'ERC-20 transfer',
      broadcastEnabled: Boolean(getNetworkConfig(networkKey).endpoints.evmRpc),
      rpcStatus: getRpcStatus(networkKey),
      message: {
        typeUrl: 'erc20.transfer',
        value: {
          token: token.erc20Address,
          fromAddress: wallet.accounts.evm.address,
          toAddress: toEvmAddress(toAddress),
          amount: parseUnits(normalizeAmount(amount), token.decimals || 18).toString(),
        },
      },
    };
  }

  // Non-QOR native tokens move via bank transfers between qor1 addresses.
  if (token?.denom !== 'uqor') {
    return composeNativeTransfer({
      fromAddress: wallet.accounts.native.address,
      toAddress: toNativeAddress(toAddress),
      amount,
      denom: token.denom,
      decimals: token.decimals || 6,
      memo: 'Aegis AI Wallet',
      networkKey,
    });
  }

  // Native QOR always moves through the cosmos bank module (see
  // submitTokenTransfer). Convert qor1/0x recipients to their qor1 encoding —
  // the same 20-byte account. Only a foreign 32-byte SVM account can't be
  // re-encoded, so it falls through to the SVM lane below.
  let nativeRecipient: string | null = null;
  try {
    nativeRecipient = toNativeAddress(toAddress);
  } catch {}
  if (nativeRecipient) {
    return composeNativeTransfer({
      fromAddress: wallet.accounts.native.address,
      toAddress: nativeRecipient,
      amount,
      denom: token.denom,
      decimals: token.decimals || 6,
      memo: 'Aegis AI Wallet',
      networkKey,
    });
  }

  const config = getNetworkConfig(networkKey);
  return {
    kind: 'SVM transfer',
    // Relayed through the chain (MsgExecuteProgram) — needs the cosmos
    // endpoints, not SVM RPC write access.
    broadcastEnabled: getRpcStatus(networkKey).enabled,
    rpcStatus: getRpcStatus(networkKey),
    message: {
      typeUrl: 'svm.system.transfer',
      value: {
        fromAddress: wallet.accounts.svm.address,
        toAddress: toAddress.trim(),
        amount: parseUnits(normalizeAmount(amount), 9).toString(),
        denom: 'lamports',
      },
    },
    edgeNote: config.edgeNote,
  };
}

export async function submitEvmTransfer({ mnemonic, toAddress, amount = '0', networkKey = defaultNetworkKey }) {
  if (!mnemonic?.trim()) throw new Error('Create or import a wallet first.');
  if (!toAddress?.trim()) throw new Error('Recipient address is required.');

  const config = getNetworkConfig(networkKey);
  if (!config.endpoints.evmRpc) throw new Error(`${config.shortName} EVM JSON-RPC endpoint is required before broadcasting.`);

  const account = await deriveEvmAccount(mnemonic);
  const evmAccount = evmAccountFromPrivateKey(hexFromBytes(account.privateKey));
  const evmClient = await createEvmClient({ rpcUrl: config.endpoints.evmRpc, chainId: config.evmChainId });
  const walletClient = evmClient.getWalletClient(evmAccount);
  const value = parseUnits(normalizeAmount(amount), 18);
  const txHash = await (walletClient as any).sendTransaction({ account: evmAccount, chain: evmClient.chain, to: toEvmAddress(toAddress), value });

  return {
    kind: 'EVM transfer',
    network: config.shortName,
    txHash,
    explorerUrl: txExplorerUrl(config, txHash),
  };
}

export async function submitSvmTransfer({ mnemonic, toAddress, amount = '0', networkKey = defaultNetworkKey }) {
  if (!mnemonic?.trim()) throw new Error('Create or import a wallet first.');
  if (!toAddress?.trim()) throw new Error('Recipient address is required.');

  const config = getNetworkConfig(networkKey);
  // SVM transfers relay through the chain: a system-program transfer
  // instruction wrapped in MsgExecuteProgram, signed by the primary key.
  const { SystemProgram } = await import('@solana/web3.js');
  const account = await getUnifiedAccount(mnemonic);
  const instruction = SystemProgram.transfer({
    fromPubkey: new PublicKey(account.svm),
    toPubkey: new PublicKey(toAddress.trim()),
    lamports: BigInt(parseUnits(normalizeAmount(amount), 9).toString()),
  });
  const message = qoreMsg.svm.executeProgram({
    sender: account.cosmos,
    programId: instruction.programId.toBytes(),
    accounts: instruction.keys.map((key) => ({ address: key.pubkey.toBytes(), isSigner: key.isSigner, isWritable: key.isWritable })),
    data: new Uint8Array(instruction.data),
  });
  const result = await submitHybridMessages({
    mnemonic,
    messages: [message],
    memo: 'Aegis AI Wallet SVM transfer',
    networkKey: config.key,
    gasFloor: 900000,
  });
  const txHash = result.transactionHash;
  return {
    kind: 'SVM transfer',
    network: config.shortName,
    txHash,
    quantumSecured: true,
    explorerUrl: txHash ? txExplorerUrl(config, txHash) : '',
  };
}

export async function submitTokenTransfer({ mnemonic, token, toAddress, amount = '0', networkKey = defaultNetworkKey, memo = '' }) {
  // Cosmos memos cap at 256 chars; EVM/SVM lanes have no memo field.
  const cleanMemo = String(memo || '').trim().slice(0, 256) || 'Aegis AI Wallet';
  if (token?.erc20Address) {
    return submitErc20Transfer({ mnemonic, token, toAddress, amount, networkKey });
  }
  if (token?.denom !== 'uqor') {
    return submitNativeTransfer({ mnemonic, toAddress: toNativeAddress(toAddress), amount, denom: token.denom, decimals: token.decimals || 6, memo: cleanMemo, networkKey });
  }
  // Native QOR lives in the cosmos bank module — that's the balance the wallet
  // shows. Deliver via a bank transfer to the recipient's qor1 encoding; for a
  // 0x/EVM address that's the SAME 20-byte account. (Routing through the EVM
  // lane failed with "insufficient funds" because that lane's balance is a
  // separate pool the user hasn't funded.) Only a foreign 32-byte SVM account
  // can't be re-encoded, so it still uses the SVM lane.
  let nativeRecipient: string | null = null;
  try {
    nativeRecipient = toNativeAddress(toAddress);
  } catch {}
  if (nativeRecipient) {
    return submitNativeTransfer({ mnemonic, toAddress: nativeRecipient, amount, denom: 'uqor', decimals: 6, memo: cleanMemo, networkKey });
  }
  return submitSvmTransfer({ mnemonic, toAddress, amount, networkKey });
}

export async function submitErc20Transfer({ mnemonic, token, toAddress, amount = '0', networkKey = defaultNetworkKey }) {
  if (!mnemonic?.trim()) throw new Error('Create or import a wallet first.');
  const evmRecipient = toEvmAddress(toAddress);

  const config = getNetworkConfig(networkKey);
  if (!config.endpoints.evmRpc) throw new Error(`${config.shortName} EVM JSON-RPC endpoint is required before broadcasting.`);

  const account = await deriveEvmAccount(mnemonic);
  const evmAccount = evmAccountFromPrivateKey(hexFromBytes(account.privateKey));
  const evmClient = await createEvmClient({ rpcUrl: config.endpoints.evmRpc, chainId: config.evmChainId });
  const walletClient = evmClient.getWalletClient(evmAccount);
  const value = parseUnits(normalizeAmount(amount), token.decimals || 18);
  const txHash = await erc20.transfer(walletClient, token.erc20Address, evmRecipient as any, value);

  return {
    kind: 'ERC-20 transfer',
    network: config.shortName,
    txHash,
    explorerUrl: txExplorerUrl(config, txHash),
  };
}
export function composeAmmSwap({ sender, poolId = '1', amountIn = '0', denomIn = 'uqor', denomOut = 'uusdc', minOut = '1', networkKey = defaultNetworkKey }) {
  if (!sender) throw new Error('Create or import a wallet first.');

  const message = amm.swapExactIn({
    sender,
    poolId: String(poolId || '1'),
    tokenIn: { denom: denomIn, amount: toBase(String(amountIn || '0')) },
    denomOut,
    minOut: String(minOut || '1'),
  });

  return {
    kind: 'AMM swap exact in',
    broadcastEnabled: getRpcStatus(networkKey).enabled,
    rpcStatus: getRpcStatus(networkKey),
    message,
    registryReady: Boolean(qorechainRegistry().lookupType(message.typeUrl)),
  };
}


/**
 * The AEGIS wallet fee on a swap: `feeBps` of the input amount, paid to the
 * treasury. Returns decimal strings (6 dp). Zero/invalid config → no fee.
 */
export function computeSwapFee(amount, feeBps = 0, treasuryAddress = '') {
  const numeric = Number.parseFloat(String(amount || '0'));
  const bps = Number(feeBps) || 0;
  if (!Number.isFinite(numeric) || numeric <= 0 || bps <= 0 || !/^qor1/i.test(String(treasuryAddress || ''))) {
    return { feeAmount: '0', netAmount: String(amount || '0'), applied: false };
  }
  const feeBase = Math.floor(numeric * 1e6 * bps / 10000);
  const netBase = Math.round(numeric * 1e6) - feeBase;
  if (feeBase <= 0 || netBase <= 0) {
    return { feeAmount: '0', netAmount: String(amount || '0'), applied: false };
  }
  return {
    feeAmount: (feeBase / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, ''),
    netAmount: (netBase / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, ''),
    applied: true,
  };
}

export async function submitAmmSwap({ mnemonic, amountIn = '0', denomIn = 'uqor', denomOut = 'uusdc', minOut = '1', poolId = '1', networkKey = defaultNetworkKey, feeBps = 0, treasuryAddress = '' }) {
  if (!mnemonic?.trim()) throw new Error('Create or import a wallet first.');

  const config = getNetworkConfig(networkKey);
  const status = getRpcStatus(networkKey);
  if (!status.enabled) {
    throw new Error(`${config.shortName} RPC and REST endpoints are required before broadcasting.`);
  }

  const account = await getUnifiedAccount(mnemonic);
  // Wallet fee is deducted from the input and paid to the treasury inside the
  // SAME transaction as the swap — atomic: either both land or neither does.
  const { feeAmount, netAmount, applied } = computeSwapFee(amountIn, feeBps, treasuryAddress);
  const preview = composeAmmSwap({
    sender: account.cosmos,
    poolId,
    amountIn: netAmount,
    denomIn,
    denomOut,
    minOut,
    networkKey: config.key,
  });

  const messages: any[] = [];
  if (applied) {
    messages.push(bank.send({
      fromAddress: account.cosmos,
      toAddress: toNativeAddress(treasuryAddress),
      amount: [{ denom: denomIn, amount: toBase(feeAmount) }],
    }));
  }
  messages.push(preview.message);

  const result = await submitHybridMessages({
    mnemonic,
    messages,
    memo: 'Aegis AI Wallet swap',
    networkKey: config.key,
    gasFloor: 900000,
  });
  const txHash = result.transactionHash;

  return {
    kind: preview.kind,
    network: config.shortName,
    message: preview.message,
    result,
    txHash,
    quantumSecured: true,
    aegisFee: applied ? feeAmount : '0',
    netAmountIn: netAmount,
    explorerUrl: txHash ? `${config.explorerUrl.replace(/\/$/, '')}/tx/${txHash}` : '',
  };
}
const zeroAddress = '0x0000000000000000000000000000000000000000';

function normalizeBridgeChain(chain: any) {
  if (!chain) return null;
  return {
    chainId: String(chain.chain_id ?? chain.chainId ?? '').trim(),
    name: String(chain.name ?? chain.chain_id ?? chain.chainId ?? 'Unknown chain'),
    chainType: String(chain.chain_type ?? chain.chainType ?? '').trim(),
    status: String(chain.status ?? '').trim().toLowerCase(),
    bridgeContract: String(chain.bridge_contract ?? chain.bridgeContract ?? '').trim(),
    minConfirmations: Number(chain.min_confirmations ?? chain.minConfirmations ?? 0) || 0,
    architecture: String(chain.architecture ?? '').trim(),
    ibcChannelId: String(chain.ibc_channel_id ?? chain.ibcChannelId ?? '').trim(),
    ibcPortId: String(chain.ibc_port_id ?? chain.ibcPortId ?? '').trim(),
  };
}

const activeBridgeStatuses = new Set(['active', 'enabled', 'live', 'ready']);

function bridgeRouteDetail(chain: any) {
  if (!chain) return 'Transfers to this network are not available yet.';
  if (!activeBridgeStatuses.has(chain.status)) {
    return `Transfers to ${chain.name} are coming soon.`;
  }
  if (chain.chainType === 'ibc') {
    if (!chain.ibcChannelId) return `Transfers to ${chain.name} are coming soon.`;
    return `Transfers to ${chain.name} are available.`;
  }
  if (!chain.bridgeContract || chain.bridgeContract === zeroAddress) {
    return `Transfers to ${chain.name} are coming soon.`;
  }
  return `Transfers to ${chain.name} are available.`;
}

export async function fetchBridgeChains({ networkKey = defaultNetworkKey } = {}) {
  const config = getNetworkConfig(networkKey);
  const client = createClient({ network: config.preset, endpoints: sdkEndpointOverrides(config.key) });
  const data: any = await client.rest.getBridgeChains();
  const chains = Array.isArray(data?.chains) ? data.chains : [];
  return chains.map(normalizeBridgeChain).filter(Boolean);
}

export async function fetchBridgeRouteStatus({ networkKey = defaultNetworkKey, destinationChain = 'ethereum' } = {}) {
  const chainId = String(destinationChain || '').trim().toLowerCase();
  try {
    const chains = await fetchBridgeChains({ networkKey });
    const chain = chains.find((item: any) => item.chainId.toLowerCase() === chainId)
      || normalizeBridgeChain({ chain_id: chainId, name: chainId, status: 'unknown' });
    const isIbc = chain?.chainType === 'ibc';
    const hasQcbTarget = Boolean(chain?.bridgeContract && chain.bridgeContract !== zeroAddress);
    const hasIbcChannel = Boolean(chain?.ibcChannelId);
    const available = Boolean(
      chain
        && activeBridgeStatuses.has(chain.status)
        && (isIbc ? hasIbcChannel : hasQcbTarget),
    );
    return {
      available,
      mode: isIbc ? 'ibc' : 'qcb',
      chain,
      chains,
      source: '/qorechain/bridge/v1/chains',
      detail: bridgeRouteDetail(chain),
    };
  } catch (caught: any) {
    return {
      available: false,
      mode: 'qcb',
      chain: normalizeBridgeChain({ chain_id: chainId, name: chainId, status: 'unknown' }),
      chains: [],
      source: '/qorechain/bridge/v1/chains',
      detail: 'Bridge availability could not be checked. Try again later.',
      error: caught?.message || String(caught),
    };
  }
}

export function composeIbcTransfer({ sender, receiver, sourceChannel, sourcePort = 'transfer', denom = 'uqor', amount = '0', memo = '' }) {
  if (!sender) throw new Error('Create or import a wallet first.');
  if (!receiver?.trim()) throw new Error('Destination address is required.');
  if (!sourceChannel?.trim()) throw new Error('IBC channel is required.');
  return {
    kind: 'IBC transfer',
    message: ibc.transfer({
      sourcePort,
      sourceChannel,
      token: { denom, amount: toBase(String(amount || '0')) },
      sender,
      receiver: receiver.trim(),
      timeoutHeight: { revisionNumber: BigInt(0), revisionHeight: BigInt(0) },
      timeoutTimestamp: BigInt(Date.now() + 60 * 60 * 1000) * BigInt(1000000),
      memo,
    }),
  };
}
export function composeBridgeWithdraw({ sender, destinationChain = 'ethereum', destinationAddress, asset = 'uqor', amount = '0', networkKey = defaultNetworkKey }) {
  if (!sender) throw new Error('Create or import a wallet first.');
  if (!destinationAddress?.trim()) throw new Error('Destination address is required.');

  const message = bridge.bridgeWithdraw({
    sender,
    destinationChain,
    destinationAddress: destinationAddress.trim(),
    asset,
    amount: toBase(String(amount || '0')),
  });

  return {
    kind: 'Bridge withdrawal',
    broadcastEnabled: getRpcStatus(networkKey).enabled,
    rpcStatus: getRpcStatus(networkKey),
    message,
    registryReady: Boolean(qorechainRegistry().lookupType(message.typeUrl)),
  };
}

export async function submitBridgeTransfer({ mnemonic, amount = '0', asset = 'uqor', destinationChain = 'ethereum', destinationAddress = '', networkKey = defaultNetworkKey, routeStatus }: any = {}) {
  if (!mnemonic?.trim()) throw new Error('Create or import a wallet first.');

  const config = getNetworkConfig(networkKey);
  const status = getRpcStatus(networkKey);
  if (!status.enabled) {
    throw new Error(`${config.shortName} RPC and REST endpoints are required before broadcasting.`);
  }

  const route = routeStatus || await fetchBridgeRouteStatus({ networkKey: config.key, destinationChain });
  if (!route.available) {
    throw new Error(route.detail || 'Transfers to this network are coming soon.');
  }

  const account = await getUnifiedAccount(mnemonic);
  const chain = route.chain || {};
  const isIbc = route.mode === 'ibc';
  const preview = isIbc
    ? composeIbcTransfer({
        sender: account.cosmos,
        receiver: destinationAddress,
        sourceChannel: chain.ibcChannelId,
        sourcePort: chain.ibcPortId || 'transfer',
        denom: asset,
        amount,
        memo: 'Aegis AI Wallet IBC transfer',
      })
    : composeBridgeWithdraw({
        sender: account.cosmos,
        destinationChain: chain.chainId || destinationChain,
        destinationAddress,
        asset,
        amount,
        networkKey: config.key,
      });

  const result = await submitHybridMessages({
    mnemonic,
    messages: [preview.message],
    memo: isIbc ? 'Aegis AI Wallet IBC transfer' : 'Aegis AI Wallet bridge withdrawal',
    networkKey: config.key,
    gasFloor: isIbc ? 650000 : 850000,
  });
  const txHash = result.transactionHash;

  return {
    kind: preview.kind,
    network: config.shortName,
    mode: route.mode,
    chain,
    message: preview.message,
    result,
    txHash,
    quantumSecured: true,
    explorerUrl: txHash ? `${config.explorerUrl.replace(/\/$/, '')}/tx/${txHash}` : '',
  };
}
export function composeSvmMemo(text = 'Aegis AI', networkKey = defaultNetworkKey) {
  const instruction = createMemoInstruction(text);
  return {
    kind: 'SVM memo instruction',
    broadcastEnabled: getRpcStatus(networkKey).enabled,
    rpcStatus: getRpcStatus(networkKey),
    programId: instruction.programId.toBase58(),
    keyCount: instruction.keys.length,
  };
}
