import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Compass,
  FileCode2,
  Globe,
  Home,
  Monitor,
  MoreVertical,
  PenLine,
  Plane,
  Plug,
  RotateCw,
  ShieldCheck,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildInjectedProvider } from '../dappProvider';
import { suppressAutoLock } from '../authLock';
import { useI18n } from '../i18n';
import { useNav } from '../nav';
import {
  dappCosmosBroadcast,
  dappCosmosGetKey,
  dappCosmosExecuteContract,
  dappCosmosSignDirect,
  dappCosmosSignArbitrary,
  dappRpcRequest,
  dappSendTransaction,
  dappSignMessage,
  dappSignRawHash,
  dappSignTransaction,
  dappSignTypedData,
  dappSvmSignAndSend,
  dappSvmSignMessage,
  dappSvmSignTransaction,
  fromBase,
  getNetworkConfig,
  shortAddress,
} from '../qoreWallet';
import { useTheme } from '../ThemeContext';
import { fonts, spacing } from '../theme';
import {
  Button,
  Card,
  EmptyState,
  Eyebrow,
  IconBtn,
  KeyValue,
  ListRow,
  Notice,
  Pill,
  PushedScreen,
  Screen,
  SectionHeader,
  Sheet,
} from '../ui';
import { AuthGateModal } from './AuthScreens';
import {
  clearBrowserHistory,
  getBrowserHistory,
  getDappConnections,
  recordBrowserVisit,
  recordLocalTx,
  removeDappConnection,
  saveDappConnection,
  updateLocalTx,
} from '../walletStorage';

type Lane = 'evm' | 'cosmos' | 'svm';

type DappRequest = {
  id: number;
  kind: 'connect' | 'switch' | 'sign' | 'typed' | 'tx' | 'cosmosSign' | 'cosmosArbitrary' | 'cosmosExecute' | 'svmSign' | 'svmTx';
  origin: string;
  payload: any;
};


/** "2h ago"-style stamp for the recent-sites rows. */
const relativeVisit = (ms: number) => {
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(ms).toLocaleDateString();
};

const hexToUtf8 = (hex: string) => {
  try {
    const clean = hex.replace(/^0x/, '');
    let out = '';
    for (let i = 0; i < clean.length; i += 2) {
      out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
    }
    return /^[\x20-\x7E\s]+$/.test(out) ? out : hex;
  } catch {
    return hex;
  }
};

const b64ToUtf8 = (b64: string) => {
  try {
    const decoded = atob(String(b64 || ''));
    return /^[\x20-\x7E\s]+$/.test(decoded) ? decoded : `${decoded.length} bytes`;
  } catch {
    return 'Binary message';
  }
};

export function BrowserScreen({ url, navigationRequest, onUrl, wallet, auth, selectedNetwork, onNetworkChanged, connectionsKey, deeplink, consumeAction, onDeeplinkConsumed, active }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const nav = useNav();
  const config = getNetworkConfig(selectedNetwork);
  // Seed from the parent-persisted URL so returning to this tab resumes the
  // same dapp instead of dropping back to the launcher. currentUrl is only
  // changed on explicit navigation (go/home/deeplink) — never from
  // onNavigationStateChange — so in-page navigation can't retrigger a load.
  const [input, setInput] = useState(() => url || '');
  const [currentUrl, setCurrentUrl] = useState(() => url || '');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [navPanelOpen, setNavPanelOpen] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [desktopMode, setDesktopMode] = useState(false);
  const [connections, setConnections] = useState<any[]>([]);
  const [requests, setRequests] = useState<DappRequest[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const webviewRef = useRef<any>(null);
  const connectionsRef = useRef<any[]>([]);
  const networkRef = useRef(selectedNetwork);
  // Skips the mount run so we only emit chainChanged on an actual switch.
  const networkReady = useRef(false);
  // The BrowserScreen remains mounted while another tab is active. Keep the
  // last native address so a live dapp can react when the user changes wallet.
  const activeNativeAddress = useRef<string | null>(null);
  // Records at most one write per distinct site (origin) as pages settle.
  const lastRecordedOrigin = useRef('');

  const recordVisit = (rawUrl: string) => {
    if (!/^https?:\/\//i.test(rawUrl)) return;
    let origin = '';
    try {
      origin = new URL(rawUrl).origin;
    } catch {
      return;
    }
    if (!origin || origin === lastRecordedOrigin.current) return;
    lastRecordedOrigin.current = origin;
    recordBrowserVisit(rawUrl).then(setHistory).catch(() => {});
  };

  const refreshConnections = () =>
    getDappConnections(selectedNetwork)
      .then((list) => {
        connectionsRef.current = list;
        setConnections(list);
      })
      .catch(() => {});

  useEffect(() => {
    networkRef.current = selectedNetwork;
    // Never authorize a new-network request with the previous network's cached
    // connection while its storage read is still in flight.
    connectionsRef.current = [];
    setConnections([]);
    refreshConnections();
    // Notify a live dapp when the user switches networks from the wallet UI.
    // The browser is kept alive across tab switches, so it never re-injects a
    // fresh provider on its own — this keeps the injected chain in sync (the
    // __qoreEmit handler updates both ethereum.chainId and the cosmos chain).
    if (networkReady.current) emit('chainChanged', config.evmChainHex);
    networkReady.current = true;
  }, [selectedNetwork]);

  // Recent sites persist across launches; load once so the launcher shows them
  // on a cold start (the browser itself always opens on the launcher).
  useEffect(() => {
    getBrowserHistory().then(setHistory).catch(() => {});
  }, []);

  // Android hardware back inside the browser: step back through page history
  // (like the panel's back arrow) instead of closing the app. Only active while
  // this tab is on top and no pushed screen (e.g. connections) owns the back.
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (nav.depth > 0) return false;
      if (currentUrl && canGoBack) {
        webviewRef.current?.goBack();
        return true;
      }
      if (currentUrl) {
        // No page history left — return to the launcher rather than exit.
        setCurrentUrl('');
        setInput('');
        onUrl('');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [active, canGoBack, currentUrl, nav.depth]);

  // Side-menu "Dapp connections" lands on this tab and opens the manager.
  // Consumed immediately so tab remounts don't re-open it.
  useEffect(() => {
    if (!connectionsKey) return;
    consumeAction?.('connections');
    nav.push(
      <DappConnectionsScreen selectedNetwork={selectedNetwork} onChanged={refreshConnections} />,
    );
  }, [connectionsKey]);

  // "Open in AEGIS" deeplinks (aegisai://browse?url=…) land directly here.
  useEffect(() => {
    if (!deeplink?.url) return;
    onDeeplinkConsumed?.();
    setInput(deeplink.url);
    setCurrentUrl(deeplink.url);
    onUrl(deeplink.url);
  }, [deeplink?.key]);

  const injectedProvider = useMemo(
    () => buildInjectedProvider(config.evmChainHex, config.evmChainId, config.chainId),
    [config.evmChainHex, config.evmChainId, config.chainId],
  );

  const evmAddress = wallet?.accounts?.evm?.address || '';
  const nativeAddress = wallet?.accounts?.native?.address || '';
  const svmAddress = wallet?.accounts?.svm?.address || '';

  const notifyActiveNativeWallet = (emitChange: boolean) => {
    webviewRef.current?.injectJavaScript(
      'window.__aegisActiveNativeAddress = ' + JSON.stringify(nativeAddress) + ';' +
      (emitChange ? 'window.dispatchEvent(new CustomEvent(\'aegis:active-wallet-changed\', { detail: ' + JSON.stringify({ nativeAddress }) + ' }));' : '') +
      'true;',
    );
  };

  useEffect(() => {
    const previous = activeNativeAddress.current;
    activeNativeAddress.current = nativeAddress;
    // Establish the initial value silently. This event is for an actual wallet
    // switch, not for a dapp's first page load.
    if (!previous || previous === nativeAddress) return;
    notifyActiveNativeWallet(true);
  }, [nativeAddress]);
  const currentOrigin = useMemo(() => {
    try {
      return new URL(currentUrl).origin;
    } catch {
      return '';
    }
  }, [currentUrl]);

  const approvedOrigin = (origin: string) =>
    connectionsRef.current.some((item) => item.origin === origin);
  const connected = Boolean(currentOrigin && approvedOrigin(currentOrigin));

  const requestedCosmosNetwork = (payload: any) => {
    const ids = Array.isArray(payload?.chainIds)
      ? payload.chainIds
      : [payload?.chainId || payload?.requestedChainId].filter(Boolean);
    const known = ids.filter((chainId: string) =>
      chainId === getNetworkConfig('mainnet').chainId || chainId === getNetworkConfig('testnet').chainId,
    );
    if (!known.length) return null;
    const activeChainId = getNetworkConfig(networkRef.current).chainId;
    const targetChainId = known.includes(activeChainId) ? activeChainId : known[0];
    return targetChainId === getNetworkConfig('testnet').chainId ? 'testnet' : 'mainnet';
  };

  const go = (nextUrl = input) => {
    const clean = nextUrl.trim();
    if (!clean) return;
    const localAddress = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(clean);
    const next = /^https?:\/\//i.test(clean) ? clean : (localAddress ? 'http://' : 'https://') + clean;
    setInput(next);
    setCurrentUrl(next);
    onUrl(next);
  };

  // The browser stays mounted between tabs, so changing its remembered URL is
  // not itself navigation. Explorer links and other in-app opens carry this
  // one-shot command to replace the current WebView source.
  useEffect(() => {
    if (!navigationRequest?.url) return;
    go(navigationRequest.url);
  }, [navigationRequest?.key]);

  const respond = (id: number, error: any, result: any) => {
    webviewRef.current?.injectJavaScript(
      'window.__qoreResolve(' + id + ', ' + JSON.stringify(error) + ', ' + JSON.stringify(result ?? null) + '); true;',
    );
  };

  const emit = (event: string, data: any) => {
    webviewRef.current?.injectJavaScript(
      'window.__qoreEmit(' + JSON.stringify(event) + ', ' + JSON.stringify(data) + '); true;',
    );
  };

  const rejectRequest = (request: DappRequest, message = 'User rejected the request.') => {
    const rejected =
      request.kind === 'connect'
        ? requests.filter(
            (item) => item.kind === 'connect' && item.origin === request.origin,
          )
        : [request];
    rejected.forEach((item) => respond(item.id, { code: 4001, message }, null));
    setRequests((queue) =>
      request.kind === 'connect'
        ? queue.filter(
            (item) => item.kind !== 'connect' || item.origin !== request.origin,
          )
        : queue.filter((item) => item.id !== request.id),
    );
    setRequestError('');
    setBusy(false);
  };

  const handleMessage = async (event: any) => {
    let data: any;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (data?.source === 'aegis-browser' && data?.type === 'system-ui') {
      // Password managers and passkey pickers briefly background Android's
      // WebView host. Keep the current unlock alive only for that short flow.
      suppressAutoLock(30000);
      return;
    }
    if (data?.source !== 'qore-provider') return;
    const { id, method, params = [] } = data;
    const liveConfig = getNetworkConfig(networkRef.current);
    let origin = String(data.origin || '');
    try {
      origin = new URL(event.nativeEvent.url).origin;
    } catch {}

    const enqueue = (kind: DappRequest['kind'], payload: any) =>
      setRequests((queue) => [...queue, { id, kind, origin, payload }]);

    try {
      switch (method) {
        case 'eth_chainId':
          return respond(id, null, liveConfig.evmChainHex);
        case 'net_version':
          return respond(id, null, String(liveConfig.evmChainId));
        case 'eth_accounts':
          return respond(id, null, approvedOrigin(origin) ? [evmAddress] : []);
        case 'eth_coinbase':
          return respond(id, null, approvedOrigin(origin) ? evmAddress : null);
        case 'eth_requestAccounts':
          if (approvedOrigin(origin)) return respond(id, null, [evmAddress]);
          return enqueue('connect', { lane: 'evm' });
        case 'wallet_switchEthereumChain': {
          const requested = String(params?.[0]?.chainId || '').toLowerCase();
          if (!requested || requested === liveConfig.evmChainHex.toLowerCase()) {
            return respond(id, null, null);
          }
          const targetNetwork =
            requested === getNetworkConfig('mainnet').evmChainHex.toLowerCase()
              ? 'mainnet'
              : requested === getNetworkConfig('testnet').evmChainHex.toLowerCase()
                ? 'testnet'
                : '';
          if (!targetNetwork) {
            return respond(id, {
              code: 4902,
              message: 'AEGIS supports QoreChain networks only (0x2649 mainnet, 0x2648 testnet).',
            }, null);
          }
          return enqueue('switch', { targetNetwork, targetChainHex: requested });
        }
        case 'wallet_addEthereumChain': {
          const requested = String(params?.[0]?.chainId || '').toLowerCase();
          const supported = [
            getNetworkConfig('mainnet').evmChainHex.toLowerCase(),
            getNetworkConfig('testnet').evmChainHex.toLowerCase(),
          ];
          if (supported.includes(requested)) return respond(id, null, null);
          return respond(id, {
            code: 4902,
            message: 'AEGIS supports QoreChain networks only.',
          }, null);
        }
        case 'personal_sign':
          return enqueue('sign', { message: params[0], address: params[1] });
        case 'eth_sign':
          return enqueue('sign', { message: params[1], address: params[0], rawHash: true });
        case 'eth_signTypedData':
        case 'eth_signTypedData_v3':
        case 'eth_signTypedData_v4':
          return enqueue('typed', { address: params[0], typedData: params[1] });
        case 'eth_sendTransaction':
          return enqueue('tx', { tx: params[0] || {} });
        case 'eth_signTransaction':
          return enqueue('tx', { tx: params[0] || {}, signOnly: true });

        case 'wallet_requestPermissions': {
          const perms = [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [evmAddress] }] }];
          if (approvedOrigin(origin)) return respond(id, null, perms);
          return enqueue('connect', { lane: 'evm', respondWith: 'permissions' });
        }
        case 'wallet_getPermissions':
          return respond(id, null, approvedOrigin(origin)
            ? [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [evmAddress] }] }]
            : []);
        case 'wallet_revokePermissions':
          await removeDappConnection(selectedNetwork, origin);
          connectionsRef.current = connectionsRef.current.filter((item) => item.origin !== origin);
          setConnections(connectionsRef.current);
          emit('accountsChanged', []);
          return respond(id, null, null);
        case 'wallet_watchAsset':
          // AEGIS tracks balances by denom automatically; acknowledge per EIP-747.
          return respond(id, null, true);

        case 'qore_cosmosEnable':
        case 'cosmos_enable': {
          const targetNetwork = requestedCosmosNetwork(params[0] || {});
          if (!targetNetwork) {
            return respond(id, { code: 4902, message: 'AEGIS supports QoreChain networks only.' }, null);
          }
          if (targetNetwork !== networkRef.current) {
            const target = getNetworkConfig(targetNetwork);
            return enqueue('switch', {
              targetNetwork,
              targetChainHex: target.evmChainHex,
              connect: { lane: 'cosmos' },
            });
          }
          if (approvedOrigin(origin)) return respond(id, null, true);
          return enqueue('connect', { lane: 'cosmos' });
        }
        case 'qore_cosmosDisable':
        case 'cosmos_disable':
          await removeDappConnection(selectedNetwork, origin);
          connectionsRef.current = connectionsRef.current.filter((item) => item.origin !== origin);
          setConnections(connectionsRef.current);
          emit('accountsChanged', []);
          return respond(id, null, true);
        case 'qore_cosmosGetKey':
        case 'cosmos_getKey': {
          const targetNetwork = requestedCosmosNetwork(params[0] || {});
          if (!targetNetwork) {
            return respond(id, { code: 4902, message: 'AEGIS supports QoreChain networks only.' }, null);
          }
          if (targetNetwork !== networkRef.current) {
            const target = getNetworkConfig(targetNetwork);
            return enqueue('switch', {
              targetNetwork,
              targetChainHex: target.evmChainHex,
              connect: { lane: 'cosmos', respondWith: 'getKey' },
            });
          }
          if (approvedOrigin(origin)) {
            return respond(id, null, await dappCosmosGetKey(wallet.mnemonic, selectedNetwork));
          }
          return enqueue('connect', { lane: 'cosmos', respondWith: 'getKey' });
        }
        case 'qore_cosmosSignDirect':
        case 'cosmos_signDirect': {
          const payload = method === 'cosmos_signDirect'
            ? { ...(params[1] || params[0] || {}), signerAddress: params[0] }
            : (params[0] || {});
          const targetNetwork = requestedCosmosNetwork(payload);
          if (targetNetwork && targetNetwork !== networkRef.current) {
            const target = getNetworkConfig(targetNetwork);
            return enqueue('switch', {
              targetNetwork,
              targetChainHex: target.evmChainHex,
              continuation: { kind: 'cosmosSign', payload },
            });
          }
          return enqueue('cosmosSign', payload);
        }
        case 'qore_executeContract': {
          const payload = params[0] || {};
          const targetNetwork = requestedCosmosNetwork(payload);
          if (targetNetwork && targetNetwork !== networkRef.current) {
            const target = getNetworkConfig(targetNetwork);
            return enqueue('switch', {
              targetNetwork,
              targetChainHex: target.evmChainHex,
              continuation: { kind: 'cosmosExecute', payload },
            });
          }
          return enqueue('cosmosExecute', payload);
        }
        case 'qore_cosmosSignArbitrary': {
          const payload = params[0] || {};
          const targetNetwork = requestedCosmosNetwork(payload);
          if (targetNetwork && targetNetwork !== networkRef.current) {
            const target = getNetworkConfig(targetNetwork);
            return enqueue('switch', {
              targetNetwork,
              targetChainHex: target.evmChainHex,
              continuation: { kind: 'cosmosArbitrary', payload },
            });
          }
          return enqueue('cosmosArbitrary', payload);
        }
        case 'qore_cosmosSendTx':
          return respond(id, null, await dappCosmosBroadcast(params[0]?.txB64, selectedNetwork));
        case 'cosmos_broadcast':
          return respond(id, null, await dappCosmosBroadcast(String(params[0] || ''), selectedNetwork));

        case 'qore_svmConnect':
        case 'svm_connect': {
          if (approvedOrigin(origin)) {
            return respond(id, null, method === 'svm_connect' ? { publicKey: svmAddress } : svmAddress);
          }
          return enqueue('connect', { lane: 'svm', raw: method === 'svm_connect' });
        }
        case 'svm_disconnect':
          return respond(id, null, true);
        case 'qore_svmSignMessage':
        case 'svm_signMessage':
        case 'qore_svmSignTransaction':
        case 'svm_signTransaction':
          return respond(id, {
            code: 4200,
            message: 'AEGIS executes QoreChain SVM actions through signAndSendTransaction; sign-only operations are not available yet.',
          }, null);
        case 'qore_svmSignAndSend':
        case 'svm_signAndSendTransaction':
          return enqueue('svmTx', {
            txB64: String(params[0] || ''),
            versioned: Boolean(params[1]),
            send: true,
            raw: method === 'svm_signAndSendTransaction',
          });

        default:
          return respond(id, null, await dappRpcRequest(method, params, selectedNetwork));
      }
    } catch (caught: any) {
      return respond(id, { code: caught?.code || -32603, message: caught?.message || 'Request failed.' }, null);
    }
  };

  const activeRequest = requests[0] || null;
  const requestedConnectLanes: Lane[] = activeRequest?.kind === 'connect'
    ? [...new Set(
        requests
          .filter(
            (request) =>
              request.kind === 'connect' && request.origin === activeRequest.origin,
          )
          .map((request) => (request.payload.lane || 'evm') as Lane),
      )]
    : [];

  const connectResult = async (request: DappRequest, networkKey = selectedNetwork) => {
    const lane: Lane = request.payload.lane || 'evm';
    if (lane === 'evm') {
      return request.payload.respondWith === 'permissions'
        ? [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [evmAddress] }] }]
        : [evmAddress];
    }
    if (lane === 'cosmos') {
      return request.payload.respondWith === 'getKey'
        ? dappCosmosGetKey(wallet.mnemonic, networkKey)
        : true;
    }
    return request.payload.raw ? { publicKey: svmAddress } : svmAddress;
  };

  const approveConnect = async () => {
    if (!activeRequest) return;
    setBusy(true);
    setRequestError('');
    try {
      const list = await saveDappConnection(selectedNetwork, activeRequest.origin, 'evm');
      connectionsRef.current = list;
      setConnections(list);
      const matching = requests.filter(
        (request) => request.kind === 'connect' && request.origin === activeRequest.origin,
      );
      for (const request of matching) {
        respond(request.id, null, await connectResult(request));
      }
      emit('accountsChanged', [evmAddress]);
      emit('connect', { chainId: config.evmChainHex });
      setRequests((queue) =>
        queue.filter(
          (request) => request.kind !== 'connect' || request.origin !== activeRequest.origin,
        ),
      );
    } catch (caught: any) {
      setRequestError(caught?.message || 'Could not connect this site.');
    } finally {
      setBusy(false);
    }
  };

  const approveSwitch = async () => {
    if (!activeRequest || activeRequest.kind !== 'switch') return;
    setBusy(true);
    setRequestError('');
    try {
      const targetNetwork = activeRequest.payload.targetNetwork;
      await onNetworkChanged(targetNetwork);
      networkRef.current = targetNetwork;
      const target = getNetworkConfig(targetNetwork);

      if (activeRequest.payload.connect) {
        const list = await saveDappConnection(targetNetwork, activeRequest.origin, 'evm');
        connectionsRef.current = list;
        setConnections(list);
        const connectRequest = {
          ...activeRequest,
          kind: 'connect' as const,
          payload: activeRequest.payload.connect,
        };
        respond(activeRequest.id, null, await connectResult(connectRequest, targetNetwork));
        emit('accountsChanged', [evmAddress]);
        emit('chainChanged', target.evmChainHex);
        emit('connect', { chainId: target.evmChainHex });
        setRequests((queue) => queue.filter((request) => request.id !== activeRequest.id));
        return;
      }

      if (activeRequest.payload.continuation) {
        const continuation = {
          id: activeRequest.id,
          origin: activeRequest.origin,
          kind: activeRequest.payload.continuation.kind,
          payload: { ...activeRequest.payload.continuation.payload, networkKey: targetNetwork },
        } as DappRequest;
        setRequests((queue) => [continuation, ...queue.filter((request) => request.id !== activeRequest.id)]);
        emit('chainChanged', target.evmChainHex);
        emit('connect', { chainId: target.evmChainHex });
        return;
      }

      respond(activeRequest.id, null, null);
      emit('chainChanged', target.evmChainHex);
      emit('connect', { chainId: target.evmChainHex });
      setRequests((queue) => queue.filter((request) => request.id !== activeRequest.id));
    } catch (caught: any) {
      setRequestError(caught?.message || 'Could not switch networks.');
    } finally {
      setBusy(false);
    }
  };

  const runSignedAction = async () => {
    if (!activeRequest) return;
    setBusy(true);
    setRequestError('');
    // Track wallet-broadcast dapp txs in the local activity log (pending →
    // success/failed) so dapp transactions also show up in Activity.
    const isBroadcast =
      (activeRequest.kind === 'tx' && !activeRequest.payload.signOnly) ||
      (activeRequest.kind === 'svmTx' && activeRequest.payload.send);
    const localId = `local_${Date.now()}`;
    if (isBroadcast) {
      recordLocalTx(selectedNetwork, nativeAddress, {
        id: localId,
        kind: 'send',
        title: activeRequest.kind === 'svmTx' ? 'SVM transaction' : 'Dapp transaction',
        status: 'Pending',
      }).catch(() => {});
    }
    try {
      let result: any;
      const requestNetwork = activeRequest.payload?.networkKey || selectedNetwork;
      switch (activeRequest.kind) {
        case 'sign':
          result = activeRequest.payload.rawHash
            ? await dappSignRawHash(wallet.mnemonic, activeRequest.payload.message)
            : await dappSignMessage(wallet.mnemonic, activeRequest.payload.message);
          break;
        case 'typed':
          result = await dappSignTypedData(wallet.mnemonic, activeRequest.payload.typedData);
          break;
        case 'tx':
          result = activeRequest.payload.signOnly
            ? await dappSignTransaction(wallet.mnemonic, activeRequest.payload.tx, selectedNetwork)
            : await dappSendTransaction(wallet.mnemonic, activeRequest.payload.tx, selectedNetwork);
          break;
        case 'cosmosSign':
          result = await dappCosmosSignDirect(wallet.mnemonic, requestNetwork, activeRequest.payload);
          break;
        case 'cosmosArbitrary':
          result = await dappCosmosSignArbitrary(wallet.mnemonic, requestNetwork, activeRequest.payload);
          break;
        case 'cosmosExecute':
          result = await dappCosmosExecuteContract(wallet.mnemonic, requestNetwork, activeRequest.payload);
          break;
        case 'svmSign': {
          const signature = await dappSvmSignMessage(wallet.mnemonic, activeRequest.payload.messageB64);
          result = activeRequest.payload.raw
            ? { signatureB64: signature, publicKey: svmAddress }
            : signature;
          break;
        }
        case 'svmTx':
          if (activeRequest.payload.send) {
            result = await dappSvmSignAndSend(
              wallet.mnemonic,
              activeRequest.payload.txB64,
              activeRequest.payload.versioned,
              selectedNetwork,
            );
            if (activeRequest.payload.raw) result = { signature: result };
          } else {
            const signed = await dappSvmSignTransaction(
              wallet.mnemonic,
              activeRequest.payload.txB64,
              activeRequest.payload.versioned,
            );
            result = activeRequest.payload.raw
              ? { signedB64: signed, publicKey: svmAddress }
              : signed;
          }
          break;
      }
      respond(activeRequest.id, null, result);
      setRequests((queue) => queue.filter((item) => item.id !== activeRequest.id));
      if (isBroadcast) {
        const hash = typeof result === 'string' ? result : result?.signature;
        updateLocalTx(selectedNetwork, nativeAddress, localId, { status: 'Success', hash }).catch(() => {});
      }
    } catch (caught: any) {
      setRequestError(caught?.message || 'The request failed.');
      if (isBroadcast) {
        updateLocalTx(selectedNetwork, nativeAddress, localId, { status: 'Failed' }).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  };
  if (!currentUrl) {
    return (
      <Screen>
        <View style={{ marginBottom: 18, marginTop: 8, paddingHorizontal: 2 }}>
          <Eyebrow>{t('Dapps')}</Eyebrow>
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 26, marginTop: 4 }}>
            Browser
          </Text>
        </View>

        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: 999,
            borderWidth: 1,
            flexDirection: 'row',
            gap: 10,
            paddingLeft: 16,
            paddingRight: 6,
            paddingVertical: 6,
          }}
        >
          <Globe color={colors.subtle} size={17} strokeWidth={2} />
          <TextInput
            style={{ color: colors.text, flex: 1, fontFamily: fonts.monoRegular, fontSize: 13, padding: 0 }}
            value={input}
            onChangeText={setInput}
            placeholder={t('Enter dapp URL…')}
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => go()}
            returnKeyType="go"
          />
          <Pressable
            onPress={() => go()}
            style={({ pressed }) => ({
              alignItems: 'center',
              backgroundColor: colors.primary,
              borderRadius: 999,
              height: 36,
              justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
              width: 36,
            })}
          >
            <ArrowRight color={colors.onPrimary} size={17} strokeWidth={2.4} />
          </Pressable>
        </View>

        <SectionHeader title={t('QoreChain ecosystem')} />
        <Card pad={false}>
          <ListRow
            first
            leading={<EcoFavicon url="https://flight.aegisagent.net" fallback={<Plane color={colors.accent} size={20} strokeWidth={2} />} />}
            title="Aegis Flight"
            sub="flight.aegisagent.net"
            trailing={<ArrowRight color={colors.subtle} size={16} strokeWidth={2.2} />}
            onPress={() => go('https://flight.aegisagent.net')}
          />
          <ListRow
            leading={<EcoFavicon url={config.explorerUrl} fallback={<Compass color={colors.accent} size={20} strokeWidth={2} />} />}
            title="QoreChain Explorer"
            sub={String(config.explorerUrl || '').replace(/^https?:\/\//, '')}
            trailing={<ArrowRight color={colors.subtle} size={16} strokeWidth={2.2} />}
            onPress={() => go(config.explorerUrl)}
          />
        </Card>

        {history.length > 0 && (
          <>
            <SectionHeader
              title={t('Recent')}
              action={t('Clear')}
              onAction={async () => {
                lastRecordedOrigin.current = '';
                setHistory(await clearBrowserHistory());
              }}
            />
            <Card pad={false}>
              {history.slice(0, 6).map((item: any, index: number) => (
                <ListRow
                  key={item.origin}
                  first={index === 0}
                  leading={
                    <EcoFavicon
                      url={item.url || item.origin}
                      size={36}
                      fallback={<Clock color={colors.subtle} size={16} strokeWidth={2} />}
                    />
                  }
                  title={item.origin.replace(/^https?:\/\//, '')}
                  sub={relativeVisit(item.lastAt)}
                  onPress={() => go(item.url || item.origin)}
                />
              ))}
            </Card>
          </>
        )}
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: spacing.screen,
          paddingVertical: 8,
        }}
      >
        <IconBtn size={38} onPress={() => setNavPanelOpen((open) => !open)}>
          <MoreVertical color={colors.text} size={18} strokeWidth={2.2} />
        </IconBtn>
        <View style={{ flex: 1 }}>
          <View
            style={{
              alignItems: 'center',
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: 999,
              borderWidth: 1,
              flexDirection: 'row',
              gap: 7,
              overflow: 'hidden',
              paddingLeft: 12,
              paddingRight: 4,
              paddingVertical: 4,
            }}
          >
            {connected && <ShieldCheck color={colors.positive} size={13} strokeWidth={2.4} />}
            <TextInput
              style={{ color: colors.text, flex: 1, fontFamily: fonts.monoRegular, fontSize: 11.5, padding: 0 }}
              value={input}
              onChangeText={setInput}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => go()}
              returnKeyType="go"
              numberOfLines={1}
            />
            <Pressable
              onPress={() => {
                if (pageLoading) {
                  webviewRef.current?.stopLoading();
                  // WebView doesn't always emit onLoadEnd after stopLoading —
                  // clear the loading UI ourselves.
                  setPageLoading(false);
                  setProgress(0);
                } else {
                  webviewRef.current?.reload();
                }
              }}
              hitSlop={6}
              style={({ pressed }) => ({
                alignItems: 'center',
                borderRadius: 15,
                height: 30,
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
                width: 30,
              })}
            >
              {pageLoading ? (
                <X color={colors.text} size={16} strokeWidth={2.2} />
              ) : (
                <RotateCw color={colors.text} size={15} strokeWidth={2.2} />
              )}
            </Pressable>
            {/* Page-load progress line along the bottom of the address bar. */}
            {pageLoading && (
              <View
                style={{
                  backgroundColor: colors.accent,
                  borderRadius: 1,
                  bottom: 0,
                  height: 2,
                  left: 0,
                  position: 'absolute',
                  width: `${Math.max(6, Math.round(progress * 100))}%`,
                }}
              />
            )}
          </View>
        </View>
      </View>

      {navPanelOpen && (
        <>
          {/* Tap anywhere outside the panel to dismiss it. */}
          <Pressable
            onPress={() => setNavPanelOpen(false)}
            style={{ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 9 }}
          />
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: spacing.radiusSm,
              borderWidth: 1,
              elevation: 6,
              flexDirection: 'row',
              gap: 6,
              left: spacing.screen,
              padding: 6,
              position: 'absolute',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.2,
              shadowRadius: 12,
              top: 54,
              zIndex: 10,
            }}
          >
            <IconBtn
              size={38}
              onPress={() => {
                if (canGoBack) webviewRef.current?.goBack();
                setNavPanelOpen(false);
              }}
            >
              <ArrowLeft color={canGoBack ? colors.text : colors.faint} size={18} strokeWidth={2.2} />
            </IconBtn>
            <IconBtn
              size={38}
              onPress={() => {
                if (canGoForward) webviewRef.current?.goForward();
                setNavPanelOpen(false);
              }}
            >
              <ArrowRight color={canGoForward ? colors.text : colors.faint} size={18} strokeWidth={2.2} />
            </IconBtn>
            <IconBtn
              size={38}
              onPress={() => {
                webviewRef.current?.reload();
                setNavPanelOpen(false);
              }}
            >
              <RotateCw color={colors.text} size={17} strokeWidth={2.2} />
            </IconBtn>
            <IconBtn
              size={38}
              active={desktopMode}
              onPress={() => {
                setDesktopMode((mode) => !mode);
                setNavPanelOpen(false);
              }}
            >
              <Monitor color={desktopMode ? colors.accent : colors.text} size={17} strokeWidth={2.2} />
            </IconBtn>
            <IconBtn
              size={38}
              onPress={() => {
                setNavPanelOpen(false);
                nav.push(
                  <DappConnectionsScreen selectedNetwork={selectedNetwork} onChanged={refreshConnections} />,
                );
              }}
            >
              <Plug color={colors.text} size={17} strokeWidth={2.2} />
            </IconBtn>
            <IconBtn
              size={38}
              onPress={() => {
                setNavPanelOpen(false);
                setCurrentUrl('');
                setInput('');
                // Clear the persisted URL too, or the launcher would snap back
                // to this dapp on the next tab switch.
                onUrl('');
              }}
            >
              <Home color={colors.text} size={17} strokeWidth={2.2} />
            </IconBtn>
          </View>
        </>
      )}

      <WebView
        key={desktopMode ? 'desktop' : 'mobile'}
        ref={webviewRef}
        source={{ uri: currentUrl }}
        style={{ backgroundColor: colors.bg, flex: 1 }}
        userAgent={
          desktopMode
            ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            : undefined
        }
        injectedJavaScriptBeforeContentLoaded={injectedProvider}
        onMessage={handleMessage}
        pullToRefreshEnabled
        startInLoadingState
        onLoadStart={() => {
          setPageLoading(true);
          setProgress(0.04);
        }}
        onLoadProgress={(event) => {
          const value = event.nativeEvent.progress;
          setPageLoading(value < 1);
          setProgress(value);
        }}
        onLoadEnd={() => {
          setPageLoading(false);
          setProgress(1);
          notifyActiveNativeWallet(false);
        }}
        onNavigationStateChange={(navState) => {
          setInput(navState.url);
          onUrl(navState.url);
          setCanGoBack(navState.canGoBack);
          setCanGoForward(navState.canGoForward);
          // Only turn the loading flag ON here (covers in-page SPA navigations);
          // turning it OFF is left to onLoadEnd/onLoadProgress so the indicator
          // isn't hidden prematurely before the page actually starts painting.
          if (navState.loading) setPageLoading(true);
          // Log the settled site for the launcher's Recent list.
          if (!navState.loading) recordVisit(navState.url);
        }}
      />

      <Sheet
        visible={Boolean(activeRequest)}
        onClose={() => activeRequest && !busy && rejectRequest(activeRequest)}
      >
        {!!activeRequest && (
          <DappRequestPanel
            request={activeRequest}
            addresses={{ evm: evmAddress, cosmos: nativeAddress, svm: svmAddress }}
            currentNetwork={config}
            requestedLanes={requestedConnectLanes}
            busy={busy}
            error={requestError}
            onApprove={() => {
              // Connecting and switching networks don't sign anything, so they
              // skip the auth gate. Everything else (signatures, transactions)
              // must pass through it before runSignedAction handles it.
              if (activeRequest.kind === 'connect') approveConnect();
              else if (activeRequest.kind === 'switch') approveSwitch();
              else setAuthOpen(true);
            }}
            onReject={() => rejectRequest(activeRequest)}
          />
        )}
      </Sheet>

      <AuthGateModal
        visible={authOpen}
        auth={auth}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={() => {
          setAuthOpen(false);
          runSignedAction();
        }}
      />
    </View>
  );
}

// Ecosystem and history icons try the favicon declared by each known site,
// then the conventional favicon.ico path before falling back to a themed icon.
function EcoFavicon({ url, fallback, size = 40 }: { url: string; fallback: React.ReactNode; size?: number }) {
  const { colors } = useTheme();
  const [sourceIndex, setSourceIndex] = useState(0);
  let origin = url;
  let hostname = '';
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    hostname = parsed.hostname;
  } catch {}
  const sources = [
    ...(/(^|\.)aegisagent\.net$/i.test(hostname) ? [origin + '/aegis.png'] : []),
    origin + '/favicon.ico',
  ];
  useEffect(() => setSourceIndex(0), [url]);
  const box = {
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: size <= 36 ? 10 : 12,
    borderWidth: 1,
    height: size,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
    width: size,
  };
  if (sourceIndex >= sources.length) return <View style={box}>{fallback}</View>;
  return (
    <View style={box}>
      <Image
        key={sources[sourceIndex]}
        source={{ uri: sources[sourceIndex] }}
        style={{ height: Math.max(20, size - 14), width: Math.max(20, size - 14) }}
        resizeMode="contain"
        onError={() => setSourceIndex((index) => index + 1)}
      />
    </View>
  );
}

function DappFavicon({ origin }: { origin: string }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 10,
          borderWidth: 1,
          height: 36,
          justifyContent: 'center',
          width: 36,
        }}
      >
        <Globe color={colors.accent} size={17} strokeWidth={2} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: `${origin}/favicon.ico` }}
      style={{ backgroundColor: colors.surface, borderRadius: 10, height: 36, width: 36 }}
      onError={() => setFailed(true)}
    />
  );
}

export function DappConnectionsScreen({ selectedNetwork, onChanged }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const nav = useNav();
  const [connections, setConnections] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    getDappConnections(selectedNetwork).then(setConnections).catch(() => {});
  }, [selectedNetwork]);

  const disconnect = async () => {
    if (!selected) return;
    const list = await removeDappConnection(selectedNetwork, selected.origin);
    setConnections(list);
    setSelected(null);
    onChanged?.();
  };

  return (
    <PushedScreen title={t('Dapp connections')} onBack={nav.pop}>
      <Card pad={false}>
        {connections.length === 0 ? (
          <EmptyState
            icon={<Plug color={colors.accent} size={22} strokeWidth={2} />}
            title={t('No connected dapps')}
            body={t('Sites you connect to in the browser appear here.')}
          />
        ) : (
          connections.map((item: any, index: number) => (
            <ListRow
              key={item.origin}
              first={index === 0}
              leading={<DappFavicon origin={item.origin} />}
              title={item.origin.replace(/^https?:\/\//, '')}
              sub="Wallet access"
              trailing={<Pill label="Connected" />}
              onPress={() => setSelected(item)}
            />
          ))
        )}
      </Card>

      <Sheet visible={Boolean(selected)} onClose={() => setSelected(null)}>
        {!!selected && (
          <>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <DappFavicon origin={selected.origin} />
              <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 17, marginTop: 12 }}>
                {selected.origin.replace(/^https?:\/\//, '')}
              </Text>
              <Text style={{ color: colors.subtle, fontSize: 12.5, marginTop: 5 }}>
                Connected to this wallet
              </Text>
            </View>
            <Text style={{ color: colors.subtle, fontSize: 12.5, lineHeight: 18, marginBottom: 14, textAlign: 'center' }}>
              Disconnecting removes this site's access to your addresses. It can request to connect
              again at any time.
            </Text>
            <View style={{ gap: 10 }}>
              <Button label={t('Disconnect')} variant="danger" onPress={disconnect} />
              <Button label={t('Cancel')} variant="secondary" onPress={() => setSelected(null)} />
            </View>
          </>
        )}
      </Sheet>
    </PushedScreen>
  );
}

function DappRequestPanel({ request, addresses, currentNetwork, requestedLanes, busy, error, onApprove, onReject }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const host = request.origin.replace(/^https?:\/\//, '');

  const heading =
    request.kind === 'connect'
      ? t('Connection request')
      : request.kind === 'switch'
        ? t('Network request')
        : request.kind === 'tx' || request.kind === 'svmTx' || request.kind === 'cosmosSign'
          ? t('Transaction request')
          : t('Signature request');
  const HeadIcon =
    request.kind === 'connect'
      ? Globe
      : request.kind === 'switch'
        ? RotateCw
        : request.kind === 'tx' || request.kind === 'svmTx' || request.kind === 'cosmosSign'
          ? FileCode2
          : PenLine;

  const tx = request.payload?.tx || {};
  const valueQor = tx.value ? fromBase(BigInt(tx.value).toString(), { exponent: 18 }) : '0';
  const isContractCall = Boolean(tx.data && tx.data !== '0x');

  let typedName = '';
  if (request.kind === 'typed') {
    try {
      typedName = JSON.parse(request.payload.typedData)?.domain?.name || '';
    } catch {}
  }

  const approveLabel =
    request.kind === 'connect'
      ? 'Connect'
      : request.kind === 'switch'
        ? (request.payload?.connect ? 'Connect & switch' : 'Switch network')
        : heading === 'Transaction request'
          ? (request.payload?.signOnly ? 'Sign transaction' : 'Approve transaction')
          : 'Sign';

  return (
    <View>
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.accentSoft,
            borderRadius: 26,
            height: 52,
            justifyContent: 'center',
            width: 52,
          }}
        >
          <HeadIcon color={colors.accent} size={24} strokeWidth={2} />
        </View>
        <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 18, marginTop: 12 }}>
          {request.kind === 'switch' && request.payload?.connect ? 'Connect & switch network' : heading}
        </Text>
        <Text style={{ color: colors.subtle, fontFamily: fonts.monoRegular, fontSize: 12, marginTop: 5 }}>
          {host}
        </Text>
      </View>

      {request.kind === 'connect' && (
        <Card pad={false}>
          <View style={{ paddingHorizontal: spacing.cardPad }}>
            {(requestedLanes.length ? requestedLanes : ['evm']).map(
              (lane: Lane, index: number) => (
                <KeyValue
                  key={lane}
                  first={index === 0}
                  label={lane === 'cosmos' ? 'Native' : lane.toUpperCase()}
                  value={shortAddress(addresses[lane], 10, 8)}
                  mono
                />
              ),
            )}
          </View>
        </Card>
      )}
      {request.kind === 'switch' && (
        <Card pad={false}>
          <View style={{ paddingHorizontal: spacing.cardPad }}>
            <KeyValue first label="Current network" value={currentNetwork.shortName} />
            <KeyValue
              label="Switch to"
              value={getNetworkConfig(request.payload.targetNetwork).shortName}
            />
            <KeyValue label="Chain ID" value={request.payload.targetChainHex} mono />
            {!!request.payload?.connect && <KeyValue label="Then" value="Connect this site" />}
          </View>
        </Card>
      )}
      {request.kind === 'sign' && (
        <>
          <Card pad={false}>
            <ScrollView style={{ maxHeight: 160 }}>
              <Text
                selectable
                style={{
                  color: colors.text,
                  fontFamily: fonts.monoRegular,
                  fontSize: 12,
                  lineHeight: 18,
                  padding: spacing.cardPad,
                }}
              >
                {hexToUtf8(String(request.payload.message || ''))}
              </Text>
            </ScrollView>
          </Card>
          <Text style={{ color: colors.warning, fontSize: 12.5, lineHeight: 18, marginTop: 12 }}>
            Signatures can authorize logins and token permissions. Only sign if you trust this app.
          </Text>
        </>
      )}

      {request.kind === 'typed' && (
        <>
          <Card pad={false}>
            <View style={{ paddingHorizontal: spacing.cardPad }}>
              {!!typedName && <KeyValue first label="App" value={typedName} />}
              <KeyValue first={!typedName} label="Type" value="Structured data (EIP-712)" />
            </View>
            <ScrollView style={{ maxHeight: 140 }}>
              <Text
                selectable
                style={{
                  color: colors.subtle,
                  fontFamily: fonts.monoRegular,
                  fontSize: 10.5,
                  lineHeight: 15,
                  padding: spacing.cardPad,
                  paddingTop: 6,
                }}
              >
                {String(request.payload.typedData || '')}
              </Text>
            </ScrollView>
          </Card>
          <Text style={{ color: colors.warning, fontSize: 12.5, lineHeight: 18, marginTop: 12 }}>
            Typed signatures can authorize token spending (permits). Review carefully.
          </Text>
        </>
      )}

      {request.kind === 'tx' && (
        <Card pad={false}>
          <View style={{ paddingHorizontal: spacing.cardPad }}>
            <KeyValue first label="Action" value={isContractCall ? 'Contract interaction' : 'Transfer'} />
            {!!tx.to && <KeyValue label="To" value={shortAddress(tx.to, 10, 8)} mono />}
            <KeyValue label="Value" value={`${valueQor} QOR`} />
            {isContractCall && (
              <KeyValue label="Data" value={`${Math.floor((String(tx.data).length - 2) / 2)} bytes`} mono />
            )}
            <KeyValue label="Network" value="QoreChain EVM" />
          </View>
        </Card>
      )}

      {request.kind === 'cosmosArbitrary' && (
        <Card pad={false}>
          <View style={{ paddingHorizontal: spacing.cardPad }}>
            <KeyValue first label="Chain" value={request.payload.chainId || 'QoreChain'} mono />
            <KeyValue label="Type" value="Native message" />
            <KeyValue label="Message" value={String(request.payload.data || '')} />
          </View>
        </Card>
      )}

      {request.kind === 'cosmosSign' && (
        <>
          <Card pad={false}>
            <View style={{ paddingHorizontal: spacing.cardPad }}>
              <KeyValue first label="Chain" value={request.payload.chainId || 'QoreChain'} mono />
              <KeyValue label="Type" value="Native transaction (SIGN_MODE_DIRECT)" />
              <KeyValue
                label="Size"
                value={`${Math.round(((request.payload.bodyB64 || '').length * 3) / 4)} bytes`}
              />
            </View>
          </Card>

        </>
      )}

      {request.kind === 'svmSign' && (
        <>
          <Card pad={false}>
            <ScrollView style={{ maxHeight: 160 }}>
              <Text
                selectable
                style={{
                  color: colors.text,
                  fontFamily: fonts.monoRegular,
                  fontSize: 12,
                  lineHeight: 18,
                  padding: spacing.cardPad,
                }}
              >
                {b64ToUtf8(String(request.payload.messageB64 || ''))}
              </Text>
            </ScrollView>
          </Card>
          <Text style={{ color: colors.warning, fontSize: 12.5, lineHeight: 18, marginTop: 12 }}>
            Signatures can authorize logins and permissions. Only sign if you trust this app.
          </Text>
        </>
      )}

      {request.kind === 'svmTx' && (
        <Card pad={false}>
          <View style={{ paddingHorizontal: spacing.cardPad }}>
            <KeyValue first label="Action" value={request.payload.send ? 'Sign and submit' : 'Sign transaction'} />
            <KeyValue label="Type" value={request.payload.versioned ? 'Versioned transaction' : 'Legacy transaction'} />
            <KeyValue
              label="Size"
              value={`${Math.round(((request.payload.txB64 || '').length * 3) / 4)} bytes`}
            />
            <KeyValue label="Network" value="QoreChain SVM" />
          </View>
        </Card>
      )}

      {!!error && (
        <View style={{ marginTop: 12 }}>
          <Notice text={error} tone="error" />
        </View>
      )}

      <View style={{ gap: 10, marginTop: 16 }}>
        <Button label={busy ? 'Working…' : approveLabel} onPress={onApprove} disabled={busy} loading={busy} />
        <Button label="Reject" variant="secondary" onPress={onReject} disabled={busy} />
      </View>
    </View>
  );
}
