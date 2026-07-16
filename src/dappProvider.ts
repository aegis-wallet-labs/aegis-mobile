/**
 * EIP-1193 provider injected into the dapp browser WebView.
 *
 * The page sees a MetaMask-compatible `window.ethereum` (plus EIP-6963
 * announcement) whose `request()` calls bridge to native over
 * `ReactNativeWebView.postMessage`. Native resolves each call via
 * `window.__qoreResolve(id, error, result)` and pushes provider events via
 * `window.__qoreEmit(event, data)`.
 *
 * QoreChain's EVM lane is PQC-exempt (classical eth_secp256k1 ante path), so
 * standard EVM signing is exactly what the chain expects here.
 */
export function buildInjectedProvider(chainIdHex: string, chainIdDecimal: number, cosmosChainId = 'qorechain-vladi') {
  return `
(function () {
  if (window.ethereum && window.ethereum.isQoreWallet) return;
  var nextId = 0;
  var pending = {};
  var listeners = {};

  // Android's credential/passkey picker can take the WebView host into the
  // background. Notify native first so the app does not lock mid-flow.
  var systemUiCooldown = false;
  function reportSystemUi() {
    if (systemUiCooldown || !window.ReactNativeWebView) return;
    systemUiCooldown = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ source: 'aegis-browser', type: 'system-ui' }));
    window.setTimeout(function () { systemUiCooldown = false; }, 1000);
  }
  window.addEventListener('blur', reportSystemUi);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') reportSystemUi();
  });

  function bridge(method, params) {
    return new Promise(function (resolve, reject) {
      nextId += 1;
      var id = nextId;
      pending[id] = { resolve: resolve, reject: reject };
      window.ReactNativeWebView.postMessage(JSON.stringify({
        source: 'qore-provider',
        id: id,
        method: method,
        params: params || [],
        origin: window.location.origin,
      }));
    });
  }

  window.__qoreResolve = function (id, error, result) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    if (error) {
      var err = new Error(error.message || 'Request rejected');
      err.code = error.code || 4001;
      entry.reject(err);
    } else {
      entry.resolve(result);
    }
  };

  window.__qoreEmit = function (event, data) {
    if (event === 'chainChanged' && ethereum) {
      ethereum.chainId = data;
      ethereum.networkVersion = String(parseInt(data, 16));
      QORE_COSMOS_CHAIN = data === '0x2648' ? 'qorechain-diana' : 'qorechain-vladi';
    }
    if (event === 'accountsChanged' && ethereum) {
      ethereum.selectedAddress = data && data[0] ? data[0] : null;
    }
    if (event === 'connect' && ethereum && data && data.chainId) {
      ethereum.chainId = data.chainId;
      ethereum.networkVersion = String(parseInt(data.chainId, 16));
    }
    (listeners[event] || []).forEach(function (fn) {
      try { fn(data); } catch (e) {}
    });
  };

  var ethereum = {
    isQoreWallet: true,
    isMetaMask: true,
    chainId: '${chainIdHex}',
    networkVersion: '${chainIdDecimal}',
    selectedAddress: null,
    request: function (args) { return bridge(args.method, args.params); },
    enable: function () { return bridge('eth_requestAccounts', []); },
    send: function (methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === 'string') {
        return bridge(methodOrPayload, paramsOrCallback);
      }
      return bridge(methodOrPayload.method, methodOrPayload.params);
    },
    sendAsync: function (payload, callback) {
      bridge(payload.method, payload.params)
        .then(function (result) { callback(null, { id: payload.id, jsonrpc: '2.0', result: result }); })
        .catch(function (error) { callback(error, null); });
    },
    on: function (event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return ethereum;
    },
    removeListener: function (event, fn) {
      listeners[event] = (listeners[event] || []).filter(function (f) { return f !== fn; });
      return ethereum;
    },
    removeAllListeners: function () {
      for (var key in listeners) delete listeners[key];
      return ethereum;
    },
  };

  window.ethereum = ethereum;

  var providerInfo = Object.freeze({
    uuid: 'aegis-qore-wallet-0001-0001-000000000001',
    name: 'AEGIS Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzBDMEMwQSIvPjx0ZXh0IHg9IjE2IiB5PSIyMiIgZm9udC1zaXplPSIxNiIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZpbGw9IiNFM0Q5QjgiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkE8L3RleHQ+PC9zdmc+',
    rdns: 'com.aegis.aegis_ai',
  });

  function announce() {
    try {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info: providerInfo, provider: ethereum }),
      }));
    } catch (e) {}
  }
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
  try { window.dispatchEvent(new Event('ethereum#initialized')); } catch (e) {}

  /* ── byte helpers for the Cosmos/SVM shims ─────────────────────────────── */
  function u8ToB64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function b64ToU8(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function hexToU8(hex) {
    var clean = hex.replace(/^0x/, '');
    var bytes = new Uint8Array(clean.length / 2);
    for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    return bytes;
  }

  /* ── Keplr-compatible Cosmos provider (window.keplr) ───────────────────── */
  var QORE_COSMOS_CHAIN = '${cosmosChainId}';
  // AEGIS speaks both QoreChain cosmos networks (mainnet vladi + testnet diana)
  // and the address is identical across them. Accept either so the native lane
  // connects regardless of which one the wallet is currently on; the native
  // layer is the source of truth and validates the chain again at sign time.
  // Only genuinely foreign cosmos chains are rejected here.
  var QORE_COSMOS_CHAINS = ['qorechain-vladi', 'qorechain-diana'];

  function assertChain(chainId) {
    if (chainId && QORE_COSMOS_CHAINS.indexOf(chainId) === -1) {
      var err = new Error('AEGIS supports QoreChain networks only.');
      err.code = 4902;
      throw err;
    }
  }

  function makeOfflineSigner(chainId) {
    return {
      getAccounts: function () {
        return bridge('qore_cosmosGetKey', [{ chainId: chainId }]).then(function (key) {
          return [{ address: key.bech32Address, algo: key.algo, pubkey: b64ToU8(key.pubKeyB64) }];
        });
      },
      signDirect: function (signerAddress, signDoc) {
        return bridge('qore_cosmosSignDirect', [{
          signerAddress: signerAddress,
          bodyB64: u8ToB64(signDoc.bodyBytes),
          authB64: u8ToB64(signDoc.authInfoBytes),
          chainId: signDoc.chainId,
          requestedChainId: chainId,
          accountNumber: String(signDoc.accountNumber),
        }]).then(function (res) {
          return {
            signed: {
              bodyBytes: b64ToU8(res.signed.bodyB64),
              authInfoBytes: b64ToU8(res.signed.authB64),
              chainId: res.signed.chainId,
              accountNumber: res.signed.accountNumber,
            },
            signature: res.signature,
          };
        });
      },
    };
  }

  var keplr = {
    isQoreWallet: true,
    version: '1.0.0',
    mode: 'mobile-web',
    enable: function (chainIds) {
      var ids = Array.isArray(chainIds) ? chainIds : [chainIds];
      ids.forEach(assertChain);
      return bridge('qore_cosmosEnable', [{ chainIds: ids }]);
    },
    experimentalSuggestChain: function (chainInfo) {
      assertChain(chainInfo && chainInfo.chainId);
      return Promise.resolve();
    },
    getKey: function (chainId) {
      assertChain(chainId);
      return bridge('qore_cosmosGetKey', [{ chainId: chainId }]).then(function (key) {
        return {
          name: key.name,
          algo: key.algo,
          bech32Address: key.bech32Address,
          pubKey: b64ToU8(key.pubKeyB64),
          address: b64ToU8(key.pubKeyB64),
          isNanoLedger: false,
        };
      });
    },
    getOfflineSigner: function (chainId) { assertChain(chainId); return makeOfflineSigner(chainId); },
    getOfflineSignerAuto: function (chainId) { assertChain(chainId); return Promise.resolve(makeOfflineSigner(chainId)); },
    getOfflineSignerOnlyAmino: function () {
      var err = new Error('QoreChain Native transactions require SIGN_MODE_DIRECT.');
      err.code = 4200;
      throw err;
    },
    getKeysSettled: function (chainIds) {
      var ids = Array.isArray(chainIds) ? chainIds : [chainIds];
      return Promise.all(ids.map(function (chainId) { return keplr.getKey(chainId); }));
    },
    disable: function () { return bridge('qore_cosmosDisable', []); },
    defaultOptions: { sign: { preferNoSetFee: false, preferNoSetMemo: false } },
    signDirect: function (chainId, signerAddress, signDoc) {
      assertChain(chainId);
      return makeOfflineSigner(chainId).signDirect(signerAddress, signDoc);
    },
    qoreExecuteContract: function (chainId, contractCall) {
      assertChain(chainId);
      return bridge('qore_executeContract', [Object.assign({}, contractCall || {}, { chainId: chainId })]);
    },
    signArbitrary: function (chainId, signerAddress, data) {
      assertChain(chainId);
      return bridge('qore_cosmosSignArbitrary', [{
        chainId: chainId,
        signerAddress: signerAddress,
        data: typeof data === 'string' ? data : '',
        dataB64: data instanceof Uint8Array ? u8ToB64(data) : '',
      }]);
    },
    signAmino: function () {
      var err = new Error('QoreChain Native transactions require SIGN_MODE_DIRECT.');
      err.code = 4200;
      return Promise.reject(err);
    },
    sendTx: function (chainId, txBytes, mode) {
      assertChain(chainId);
      return bridge('qore_cosmosSendTx', [{ txB64: u8ToB64(txBytes), mode: mode }]).then(hexToU8);
    },
  };
  if (!window.keplr) {
    window.keplr = keplr;
    window.getOfflineSigner = keplr.getOfflineSigner;
    window.getOfflineSignerAuto = keplr.getOfflineSignerAuto;
    window.getOfflineSignerOnlyAmino = keplr.getOfflineSignerOnlyAmino;
    try { window.dispatchEvent(new Event('keplr_keystorechange')); } catch (e) {}
  }

  // The QoreChain SDK exposes a unified SVM address but no matching standard
  // ed25519 signer. Do not impersonate a Phantom/Solana wallet here: doing so
  // would expose the canonical address while signing with a different key.

})();
true;
`;
}
