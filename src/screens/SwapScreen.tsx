import * as Clipboard from 'expo-clipboard';
import { ArrowDown, CheckCircle2, ChevronDown, SlidersHorizontal, XCircle } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useWalletAssets } from '../hooks';
import { useI18n } from '../i18n';
import { useRemoteConfig } from '../remoteConfig';
import {
  composeAmmSwap,
  composeBridgeWithdraw,
  composeIbcTransfer,
  computeSwapFee,
  fetchAmmRouteStatus,
  fetchBridgeChains,
  fetchBridgeRouteStatus,
  shortAddress,
  submitAmmSwap,
  submitBridgeTransfer,
  symbolForDenom,
} from '../qoreWallet';
import { formatAmountDisplay } from '../format';
import { useTheme } from '../ThemeContext';
import { fonts, spacing } from '../theme';
import {
  Button,
  Card,
  Eyebrow,
  KeyValue,
  ListRow,
  LoadingDots,
  Notice,
  Pill,
  Screen,
  Sheet,
  SheetTextInput,
  TokenIcon,
  TokenSelectSheet,
  useFocusGlow,
} from '../ui';
import { AuthGateModal } from './AuthScreens';
import { ContactPickerSheet } from './ContactsScreens';

const formatBps = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

/** quote amounts arrive in base units (6 decimals) */
const displayBaseAmount = (raw: any) => {
  const value = Number(String(raw ?? '')) / 1e6;
  return Number.isFinite(value) ? value : null;
};

const formatEditableAmount = (value: number) =>
  Number.isFinite(value) ? String(Number(value.toFixed(6))) : '';

// Bridge ships later — flip this to show the Swap/Bridge tabs again. All the
// bridge code below stays wired and remote-gated (CONFIG_BRIDGE_ENABLED).
const BRIDGE_TAB_ENABLED = false;

const liveBridgeStatuses = new Set(['active', 'enabled', 'live', 'ready']);
const bridgeStatusTone = (status?: string) => (liveBridgeStatuses.has(String(status || '').toLowerCase()) ? 'positive' : 'neutral');
const bridgeAvailabilityLabel = (status?: string) => (liveBridgeStatuses.has(String(status || '').toLowerCase()) ? 'Available' : 'Soon');

const chainIcons: Record<string, any> = {
  qorechain: require('../../assets/aegis/networks/qore.png'),
  qore: require('../../assets/aegis/networks/qore.png'),
  ethereum: require('../../assets/aegis/tokens/eth.png'),
  polygon: require('../../assets/aegis/networks/polygon.png'),
  bsc: require('../../assets/aegis/networks/bnb.png'),
  bnb: require('../../assets/aegis/networks/bnb.png'),
  arbitrum: require('../../assets/aegis/networks/arb.png'),
  near: require('../../assets/aegis/networks/near.png'),
  sui: require('../../assets/aegis/networks/sui.png'),
  ton: require('../../assets/aegis/networks/ton.png'),
  solana: require('../../assets/aegis/tokens/sol.png'),
};

function ChainAvatar({ chain, size = 36 }: { chain: any; size?: number }) {
  const { colors } = useTheme();
  const source = chainIcons[String(chain?.chainId || '').toLowerCase()];
  if (source) {
    return <Image source={source} style={{ borderRadius: size / 2, height: size, width: size }} />;
  }
  const initials = String(chain?.name || chain?.chainId || '?').slice(0, 2).toUpperCase();
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: colors.accentSoft,
        borderRadius: size / 2,
        height: size,
        justifyContent: 'center',
        width: size,
      }}
    >
      <Text style={{ color: colors.accent, fontFamily: fonts.displaySemi, fontSize: size * 0.32 }}>
        {initials}
      </Text>
    </View>
  );
}

const chainTypeLabel = (chain: any) =>
  chain?.chainType === 'ibc' ? 'IBC · Cosmos' : 'EVM network';

function validateDestinationAddress(chain: any, address: string) {
  const value = address.trim();
  if (!value) return 'Enter a destination address.';
  if (chain?.chainType === 'ibc') return value.length >= 8 ? '' : 'Enter the destination chain address.';
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? '' : 'Enter a valid EVM address.';
}

export function SwapScreen({ wallet, auth, selectedNetwork, prefill }: any) {
  const { colors } = useTheme();
  const { bridgeEnabled, swapEnabled, swapFeeBps, treasuryAddress } = useRemoteConfig();
  const { t } = useI18n();
  const swapGlow = useFocusGlow();
  const receiveGlow = useFocusGlow();
  const bridgeAmountGlow = useFocusGlow();
  const bridgeDestGlow = useFocusGlow();
  const [mode, setMode] = useState<'swap' | 'bridge'>('swap');
  const [feeOpen, setFeeOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [receiveAmount, setReceiveAmount] = useState('');
  const [quoteSide, setQuoteSide] = useState<'in' | 'out'>('in');
  const [denomIn, setDenomIn] = useState('uqor');
  // null until the wallet actually knows a second token — the "To" pill shows
  // "Select" instead of advertising a token that isn't live yet.
  const [denomOut, setDenomOut] = useState<string | null>(null);
  const [poolId] = useState('1');
  const [slippageBps, setSlippageBps] = useState(100);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [tokenSelectFor, setTokenSelectFor] = useState<'in' | 'out' | 'bridge' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [bridgeAmount, setBridgeAmount] = useState('');
  const [bridgeAsset, setBridgeAsset] = useState('uqor');
  const [bridgeDestinationChain, setBridgeDestinationChain] = useState('ethereum');
  const [bridgeDestinationAddress, setBridgeDestinationAddress] = useState('');
  const [bridgeChains, setBridgeChains] = useState<any[]>([]);
  const [bridgeChainsLoading, setBridgeChainsLoading] = useState(false);
  const [bridgeSelectOpen, setBridgeSelectOpen] = useState(false);
  const [bridgePreview, setBridgePreview] = useState<any>(null);
  const [bridgeResult, setBridgeResult] = useState<any>(null);
  const [bridgeError, setBridgeError] = useState('');
  const [bridgeSubmitError, setBridgeSubmitError] = useState('');
  const [bridgePreviewOpen, setBridgePreviewOpen] = useState(false);
  const [bridgeAuthOpen, setBridgeAuthOpen] = useState(false);
  const [bridgeContactsOpen, setBridgeContactsOpen] = useState(false);
  // Live quote for the "To" field while typing (debounced). null = idle,
  // {pending} = fetching, {available, out, poolId, detail} = resolved.
  const [liveQuote, setLiveQuote] = useState<any>(null);

  // "Swap" from a token detail screen lands here with that token preselected.
  useEffect(() => {
    if (prefill?.mode === 'bridge' && BRIDGE_TAB_ENABLED) {
      setMode('bridge');
      setBridgePreview(null);
      return;
    }
    if (!prefill?.denom) return;
    setMode('swap');
    setDenomIn(prefill.denom);
    setDenomOut(null);
    setAmount('');
    setReceiveAmount('');
    setQuoteSide('in');
    setPreview(null);
  }, [prefill?.key]);

  useEffect(() => {
    if (mode !== 'bridge') return;
    let active = true;
    setBridgeChainsLoading(true);
    // Only real chains from the on-chain bridge registry — no placeholder
    // list. Empty means the registry hasn't published destinations yet.
    fetchBridgeChains({ networkKey: selectedNetwork })
      .then((chains) => {
        if (active) setBridgeChains(Array.isArray(chains) ? chains : []);
      })
      .catch(() => {
        if (active) setBridgeChains([]);
      })
      .finally(() => {
        if (active) setBridgeChainsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, selectedNetwork]);

  const { tokens: walletTokens } = useWalletAssets(wallet, selectedNetwork, refreshKey);
  const balances = useMemo(() => {
    const next: Record<string, string> = {};
    for (const token of walletTokens) next[token.denom] = token.balance;
    return next;
  }, [walletTokens]);

  const balanceIn = balances[denomIn] ?? '0';
  const symbolIn = symbolForDenom(denomIn);
  const symbolOut = denomOut ? symbolForDenom(denomOut) : '';

  // Default the "To" side to the first other token the wallet tracks; stays
  // empty until a second token exists on-chain (auto-discovery adds it).
  useEffect(() => {
    if (denomOut && denomOut !== denomIn) return;
    const counter = walletTokens.find((token: any) => token.denom && token.denom !== denomIn);
    setDenomOut(counter ? counter.denom : null);
  }, [walletTokens, denomIn, denomOut]);

  // Either amount field can be the source: exact-in fills "To"; exact-out
  // calculates the required "From" amount. Only the SOURCE side is a
  // dependency — writing the derived field must not re-trigger the effect
  // (that caused a duplicate fetch + loading flicker after every quote).
  const sourceAmount = quoteSide === 'in' ? amount : receiveAmount;
  useEffect(() => {
    const parsed = Number.parseFloat(sourceAmount || '0');
    if (!swapEnabled || !denomOut || !Number.isFinite(parsed) || parsed <= 0) {
      setLiveQuote(null);
      return;
    }
    let active = true;
    setLiveQuote({ pending: true });
    const timer = setTimeout(async () => {
      try {
        const fee = computeSwapFee(sourceAmount, swapFeeBps, treasuryAddress);
        const route = await fetchAmmRouteStatus({
          networkKey: selectedNetwork,
          poolId,
          denomIn,
          denomOut,
          amountIn: quoteSide === 'in' ? fee.netAmount : '0',
          amountOut: quoteSide === 'out' ? sourceAmount : '0',
          mode: quoteSide === 'in' ? 'exact-in' : 'exact-out',
        });
        if (!active) return;
        const quotedBase = quoteSide === 'in'
          ? route.quote?.amount_out ?? route.quote?.amountOut
          : route.quote?.amount_in ?? route.quote?.amountIn;
        const quotedValue = displayBaseAmount(quotedBase);
        if (route.available && quotedValue != null) {
          if (quoteSide === 'in') setReceiveAmount(formatEditableAmount(quotedValue));
          else setAmount(formatEditableAmount(quotedValue));
          setLiveQuote({ available: true, poolId: route.poolId, detail: route.detail });
        } else {
          setLiveQuote({ available: false, detail: route.detail });
        }
      } catch {
        if (active) setLiveQuote({ available: false });
      }
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sourceAmount, denomIn, denomOut, quoteSide, swapEnabled, swapFeeBps, treasuryAddress, selectedNetwork, poolId]);

  const amountNumber = Number.parseFloat(amount || '0');
  const insufficient = Number.isFinite(amountNumber) && amountNumber > Number.parseFloat(balanceIn || '0');
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;

  // Wallet fee: deducted from the input, paid to the treasury atomically with
  // the swap. The quote is fetched for the net amount so numbers stay honest.
  const swapFee = computeSwapFee(amount || '0', swapFeeBps, treasuryAddress);
  const networkFeeQor = 0.09; // 900k gas floor Ã— 0.1uqor — refined at broadcast

  // Expected output from the on-chain quote; minimum received derives from slippage.
  const quoteOutBase = preview?.routeStatus?.quote?.amount_out ?? preview?.routeStatus?.quote?.amountOut;
  const expectedOut = displayBaseAmount(quoteOutBase);
  const minOutBase = useMemo(() => {
    try {
      if (!quoteOutBase) return null;
      return String((BigInt(String(quoteOutBase)) * BigInt(10000 - slippageBps)) / BigInt(10000));
    } catch {
      return null;
    }
  }, [quoteOutBase, slippageBps]);
  const minReceived = displayBaseAmount(minOutBase);

  const bridgeChainOptions = bridgeChains;
  const selectedBridgeChain =
    bridgeChainOptions.find((chain: any) => chain.chainId === bridgeDestinationChain) ||
    bridgeChainOptions[0] ||
    null;
  const bridgeChainsUnavailable = !bridgeChainsLoading && bridgeChainOptions.length === 0;
  const bridgeAssetSymbol = symbolForDenom(bridgeAsset);
  const bridgeBalance = balances[bridgeAsset] ?? '0';
  const bridgeAmountNumber = Number.parseFloat(bridgeAmount || '0');
  const bridgeAmountValid = Number.isFinite(bridgeAmountNumber) && bridgeAmountNumber > 0;
  const bridgeInsufficient = Number.isFinite(bridgeAmountNumber) && bridgeAmountNumber > Number.parseFloat(bridgeBalance || '0');
  const bridgeDestinationError = validateDestinationAddress(selectedBridgeChain, bridgeDestinationAddress);
  const bridgeNetworkFeeQor = selectedBridgeChain?.chainType === 'ibc' ? 0.065 : 0.085;

  const compose = async () => {
    setError('');
    setResult(null);
    setSubmitError('');
    if (!amountValid) {
      setError(t('Enter an amount to swap.'));
      return;
    }
    if (insufficient) {
      setError(`Insufficient ${symbolIn} balance. Available: ${balanceIn} ${symbolIn}.`);
      return;
    }
    setSubmitting(true);
    try {
      const routeStatus = await fetchAmmRouteStatus({
        networkKey: selectedNetwork,
        poolId,
        denomIn,
        denomOut,
        amountIn: swapFee.netAmount,
      });
      setPreview({
        ...composeAmmSwap({
          sender: wallet.accounts.native.address,
          poolId,
          amountIn: amount,
          denomIn,
          denomOut,
          minOut: '1',
          networkKey: selectedNetwork,
        }),
        routeStatus,
      });
      setPreviewOpen(true);
    } catch (caught: any) {
      setPreview(null);
      setError(caught?.message || String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const submitSwap = async () => {
    setSubmitError('');
    setResult(null);
    setSubmitting(true);
    try {
      const swapResult = await submitAmmSwap({
        mnemonic: wallet.mnemonic,
        amountIn: amount,
        denomIn,
        denomOut,
        minOut: minOutBase || '1',
        poolId: preview?.routeStatus?.poolId || poolId,
        networkKey: selectedNetwork,
        feeBps: swapFeeBps,
        treasuryAddress,
      });
      setResult(swapResult);
      setRefreshKey((key) => key + 1);
    } catch (caught: any) {
      setSubmitError(caught?.message || String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setResult(null);
    setSubmitError('');
    setPreview(null);
    setFeeOpen(false);
  };

  const closeBridgePreview = () => {
    setBridgePreviewOpen(false);
    setBridgeResult(null);
    setBridgeSubmitError('');
    setBridgePreview(null);
  };

  const composeBridge = async () => {
    setBridgeError('');
    setBridgeResult(null);
    setBridgeSubmitError('');
    if (!selectedBridgeChain) {
      setBridgeError('No destination networks are available yet.');
      return;
    }
    if (!bridgeAmountValid) {
      setBridgeError('Enter an amount to bridge.');
      return;
    }
    if (bridgeInsufficient) {
      setBridgeError(`Insufficient ${bridgeAssetSymbol} balance. Available: ${bridgeBalance} ${bridgeAssetSymbol}.`);
      return;
    }
    if (bridgeDestinationError) {
      setBridgeError(bridgeDestinationError);
      return;
    }
    setSubmitting(true);
    try {
      const routeStatus = await fetchBridgeRouteStatus({ networkKey: selectedNetwork, destinationChain: selectedBridgeChain.chainId });
      const chain = routeStatus.chain || selectedBridgeChain;
      const previewMessage = routeStatus.mode === 'ibc' && chain?.ibcChannelId
        ? composeIbcTransfer({ sender: wallet.accounts.native.address, receiver: bridgeDestinationAddress, sourceChannel: chain.ibcChannelId, sourcePort: chain.ibcPortId || 'transfer', denom: bridgeAsset, amount: bridgeAmount, memo: 'Aegis AI Wallet IBC transfer' })
        : composeBridgeWithdraw({ sender: wallet.accounts.native.address, destinationChain: chain?.chainId || selectedBridgeChain.chainId, destinationAddress: bridgeDestinationAddress, asset: bridgeAsset, amount: bridgeAmount, networkKey: selectedNetwork });
      setBridgePreview({ ...previewMessage, routeStatus, chain });
      setBridgePreviewOpen(true);
    } catch (caught: any) {
      setBridgePreview(null);
      setBridgeError(caught?.message || String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const submitBridge = async () => {
    setBridgeSubmitError('');
    setBridgeResult(null);
    setSubmitting(true);
    try {
      const transferResult = await submitBridgeTransfer({ mnemonic: wallet.mnemonic, amount: bridgeAmount, asset: bridgeAsset, destinationChain: bridgePreview?.chain?.chainId || selectedBridgeChain.chainId, destinationAddress: bridgeDestinationAddress, networkKey: selectedNetwork, routeStatus: bridgePreview?.routeStatus });
      setBridgeResult(transferResult);
      setRefreshKey((key) => key + 1);
    } catch (caught: any) {
      setBridgeSubmitError(caught?.message || String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  // Any native QoreChain token the wallet tracks (defaults + imported +
  // auto-discovered) is selectable; the pool lookup decides per pair whether
  // a swap is actually possible.
  const swapTokens = walletTokens.filter((token: any) => token.vm === 'Native' || !token.vm);

  const selectToken = (side: 'in' | 'out' | 'bridge', denom: string) => {
    if (side === 'bridge') {
      setBridgeAsset(denom);
      setBridgePreview(null);
      return;
    }
    if (side === 'in') {
      if (denom === denomOut) setDenomOut(denomIn);
      setDenomIn(denom);
    } else {
      if (denom === denomIn && !denomOut) return;
      if (denom === denomIn) setDenomIn(denomOut as string);
      setDenomOut(denom);
    }
    setPreview(null);
  };

  const flipPair = () => {
    if (!denomOut) return;
    setDenomIn(denomOut);
    setDenomOut(denomIn);
    setAmount('');
    setReceiveAmount('');
    setQuoteSide('in');
    setPreview(null);
  };

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.screen,
          paddingVertical: 10,
        }}
      >
        <View style={{ width: 42 }} />
        <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 18 }}>{mode === 'swap' ? 'Swap' : 'Bridge'}</Text>
        {mode === 'swap' ? (
          <Pressable
            onPress={() => setSlippageOpen(true)}
            hitSlop={6}
            style={({ pressed }) => ({
              alignItems: 'center',
              backgroundColor: pressed ? colors.cardPressed : colors.surface,
              borderColor: colors.border,
              borderRadius: 21,
              borderWidth: 1,
              height: 42,
              justifyContent: 'center',
              width: 42,
            })}
          >
            <SlidersHorizontal color={colors.text} size={18} strokeWidth={2.2} />
          </Pressable>
        ) : (
          <View style={{ width: 42 }} />
        )}
      </View>

      {BRIDGE_TAB_ENABLED && (
        <View style={{ paddingBottom: 8, paddingHorizontal: spacing.screen }}>
          <ModeTabs mode={mode} onChange={(next: 'swap' | 'bridge') => { setMode(next); setError(''); setBridgeError(''); }} />
          {mode === 'bridge' && (
            <Text style={{ color: colors.subtle, fontSize: 12, lineHeight: 17, marginTop: 8, paddingHorizontal: 2 }}>
              Moves assets from QoreChain to another network. Bridging in starts on the source chain.
            </Text>
          )}
        </View>
      )}

      {mode === 'swap' ? (
        <>
        <Screen bottom={16}>
        <Card pad={false} style={swapGlow.style}>
          <View style={{ padding: spacing.cardPad }}>
            <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
              <Eyebrow>{t('From')}</Eyebrow>
              <Text style={{ color: insufficient ? colors.negative : colors.subtle, fontFamily: fonts.monoRegular, fontSize: 11 }}>
                {t('Balance')}: {formatAmountDisplay(balanceIn)} {symbolIn}
              </Text>
            </View>
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
              <TokenPickerPill symbol={symbolIn} onPress={() => setTokenSelectFor('in')} />
              <Pressable
                onPress={() => {
                  setQuoteSide('in');
                  setAmount(balanceIn);
                  setReceiveAmount('');
                  setPreview(null);
                }}
                style={({ pressed }) => ({
                  backgroundColor: colors.accentSoft,
                  borderRadius: 8,
                  opacity: pressed ? 0.7 : 1,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                })}
              >
                <Text style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1 }}>
                  MAX
                </Text>
              </Pressable>
              <TextInput
                style={{
                  color: insufficient ? colors.negative : colors.text,
                  flex: 1,
                  fontFamily: fonts.display,
                  fontSize: 28,
                  letterSpacing: -0.5,
                  padding: 0,
                  textAlign: 'right',
                }}
                {...swapGlow.inputProps}
                value={amount}
                onChangeText={(next) => {
                  setQuoteSide('in');
                  setAmount(next);
                  setReceiveAmount('');
                  setPreview(null);
                  setError('');
                }}
                placeholder="0.00"
                placeholderTextColor={colors.faint}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <View style={{ alignItems: 'center', flexDirection: 'row' }}>
            <View style={{ backgroundColor: colors.borderSoft, flex: 1, height: 1 }} />
            <Pressable
              onPress={flipPair}
              style={({ pressed }) => ({
                alignItems: 'center',
                backgroundColor: pressed ? colors.cardPressed : colors.surface,
                borderColor: colors.border,
                borderRadius: 18,
                borderWidth: 1,
                height: 36,
                justifyContent: 'center',
                marginHorizontal: 14,
                width: 36,
              })}
            >
              <ArrowDown color={colors.accent} size={17} strokeWidth={2.2} />
            </Pressable>
            <View style={{ backgroundColor: colors.borderSoft, flex: 1, height: 1 }} />
          </View>

          <View style={{ padding: spacing.cardPad }}>
            <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
              <Eyebrow>{t('To')}</Eyebrow>
              {!!denomOut && (
                <Text style={{ color: colors.subtle, fontFamily: fonts.monoRegular, fontSize: 11 }}>
                  {t('Balance')}: {formatAmountDisplay(balances[denomOut] ?? '0')} {symbolOut}
                </Text>
              )}
            </View>
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
              <TokenPickerPill symbol={symbolOut} onPress={() => setTokenSelectFor('out')} />
              <TextInput
                style={{
                  color: colors.text,
                  flex: 1,
                  fontFamily: fonts.display,
                  fontSize: 28,
                  letterSpacing: -0.5,
                  padding: 0,
                  textAlign: 'right',
                }}
                {...receiveGlow.inputProps}
                value={receiveAmount}
                onChangeText={(next) => {
                  setQuoteSide('out');
                  setReceiveAmount(next);
                  setAmount('');
                  setPreview(null);
                  setError('');
                }}
                placeholder="0.00"
                placeholderTextColor={colors.faint}
                keyboardType="decimal-pad"
              />
            </View>
            {!!liveQuote && !liveQuote.pending && !liveQuote.available && amountValid && (
              <Text style={{ color: colors.faint, fontSize: 11.5, marginTop: 8, textAlign: 'right' }}>
                {t('No live pool for this pair yet')}
              </Text>
            )}
          </View>
        </Card>

        <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 4 }}>
          <Text style={{ color: colors.subtle, fontSize: 12.5 }}>{t('Slippage tolerance')}</Text>
          <Pressable onPress={() => setSlippageOpen(true)} hitSlop={8}>
            <Text style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: 12 }}>
              {formatBps(slippageBps)}
            </Text>
          </Pressable>
        </View>

        {((submitting && !previewOpen) || liveQuote?.pending) && (
          <View
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              gap: 10,
              justifyContent: 'center',
              marginTop: 16,
            }}
          >
            <LoadingDots size={4} />
            <Text
              style={{
                color: colors.faint,
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
              }}
            >
              {`${t('Finding best price')} · ${symbolIn} → ${symbolOut}`}
            </Text>
          </View>
        )}

        {!swapEnabled && (
          <View style={{ marginTop: 14 }}>
            <Notice text="Swaps are temporarily disabled." />
          </View>
        )}

        {!!error && (
          <View style={{ marginTop: 14 }}>
            <Notice text={error} tone="error" />
          </View>
        )}

        </Screen>
        {/* Pinned above the tab bar so the primary action never scrolls away. */}
        <View style={{ paddingBottom: 12, paddingHorizontal: spacing.screen, paddingTop: 10 }}>
          <Button
            label={
              !swapEnabled
                ? t('Swaps coming soon')
                : insufficient
                  ? `${t('Insufficient balance')} · ${symbolIn}`
                  : submitting && !previewOpen
                    ? t('Fetching quote…')
                    : t('Review swap')
            }
            onPress={compose}
            disabled={!swapEnabled || !denomOut || submitting || insufficient || !amountValid}
            loading={submitting && !previewOpen}
          />
        </View>
        </>
      ) : (
        <Screen>
          <Card pad={false} style={bridgeAmountGlow.style}>
            <View style={{ padding: spacing.cardPad }}>
              <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <Eyebrow>From</Eyebrow>
                <Text style={{ color: bridgeInsufficient ? colors.negative : colors.subtle, fontFamily: fonts.monoRegular, fontSize: 11 }}>Balance: {formatAmountDisplay(bridgeBalance)} {bridgeAssetSymbol}</Text>
              </View>
              <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
                <TokenPickerPill symbol={bridgeAssetSymbol} onPress={() => setTokenSelectFor('bridge')} />
                <Pressable onPress={() => { setBridgeAmount(bridgeBalance); setBridgePreview(null); }} style={({ pressed }) => ({ backgroundColor: colors.accentSoft, borderRadius: 8, opacity: pressed ? 0.7 : 1, paddingHorizontal: 10, paddingVertical: 6 })}>
                  <Text style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1 }}>MAX</Text>
                </Pressable>
                <TextInput style={{ color: bridgeInsufficient ? colors.negative : colors.text, flex: 1, fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.5, padding: 0, textAlign: 'right' }} {...bridgeAmountGlow.inputProps} value={bridgeAmount} onChangeText={(next) => { setBridgeAmount(next); setBridgePreview(null); setBridgeError(''); }} placeholder="0.00" placeholderTextColor={colors.faint} keyboardType="decimal-pad" />
              </View>
            </View>
          </Card>

          {bridgeChainsUnavailable ? (
            <View style={{ marginTop: 12 }}>
              <Notice text="Destination networks aren't available yet — QoreChain's bridge registry hasn't published any chains. They'll appear here automatically once it does." />
            </View>
          ) : (
          <View style={{ marginTop: 12 }}>
            <Card pad={false}>
              <View style={{ padding: spacing.cardPad }}>
                <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Eyebrow>Destination</Eyebrow>
                  {!!selectedBridgeChain && (
                    <Pill label={bridgeAvailabilityLabel(selectedBridgeChain?.status)} tone={bridgeStatusTone(selectedBridgeChain?.status) as any} />
                  )}
                </View>
                <ChainPickerPill chain={selectedBridgeChain} onPress={() => setBridgeSelectOpen(true)} />
                <TextInput style={[{ backgroundColor: colors.surface, borderColor: bridgeDestinationError && bridgeDestinationAddress ? colors.negative : colors.border, borderRadius: spacing.radiusSm, borderWidth: 1, color: colors.text, fontFamily: fonts.monoRegular, fontSize: 13, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12 }, !bridgeDestinationError && bridgeDestGlow.style]} {...bridgeDestGlow.inputProps} value={bridgeDestinationAddress} onChangeText={(next) => { setBridgeDestinationAddress(next); setBridgePreview(null); setBridgeError(''); }} placeholder={`Your address on ${selectedBridgeChain?.name || 'the destination chain'}`} placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} />
                <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  {selectedBridgeChain?.chainType !== 'ibc' && (
                    <Pressable
                      onPress={() => {
                        setBridgeDestinationAddress(wallet.accounts.evm.address);
                        setBridgePreview(null);
                        setBridgeError('');
                      }}
                      style={({ pressed }) => ({
                        backgroundColor: colors.accentSoft,
                        borderRadius: 8,
                        opacity: pressed ? 0.7 : 1,
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                      })}
                    >
                      <Text style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8 }}>
                        USE MY EVM ADDRESS
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => setBridgeContactsOpen(true)}
                    style={({ pressed }) => ({
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: 8,
                      borderWidth: 1,
                      opacity: pressed ? 0.7 : 1,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                    })}
                  >
                    <Text style={{ color: colors.subtle, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8 }}>
                      CONTACTS
                    </Text>
                  </Pressable>
                </View>
              </View>
            </Card>
          </View>
          )}

          {!!selectedBridgeChain && (
            <View style={{ marginTop: 12 }}>
              <Card pad={false}>
                <View style={{ paddingHorizontal: spacing.cardPad }}>
                  <KeyValue first label="Status" value={bridgeAvailabilityLabel(selectedBridgeChain?.status)} />
                  {/* Our own gas budget for this route (matches the gasFloor
                      used at signing) — not a guess about chain-side fees. */}
                  <KeyValue label="Network fee (est.)" value={`~${bridgeNetworkFeeQor} QOR`} />
                </View>
              </Card>
            </View>
          )}

          {bridgeChainsLoading && <View style={{ marginTop: 12 }}><Card><View style={{ alignItems: 'center', flexDirection: 'row', gap: 12 }}><LoadingDots /><Text style={{ color: colors.subtle, fontSize: 12 }}>Checking availability</Text></View></Card></View>}
          {!bridgeEnabled && <View style={{ marginTop: 14 }}><Notice text="Bridge is coming soon. It will turn on automatically after final testing." /></View>}
          {!!bridgeError && <View style={{ marginTop: 14 }}><Notice text={bridgeError} tone="error" /></View>}

          <View style={{ marginTop: 16 }}>
            <Button label={!bridgeEnabled ? 'Bridge coming soon' : bridgeChainsUnavailable ? 'No destinations available' : bridgeInsufficient ? `Insufficient ${bridgeAssetSymbol} balance` : submitting && !bridgePreviewOpen ? 'Checking availability' : 'Review transaction'} onPress={composeBridge} disabled={!bridgeEnabled || !selectedBridgeChain || submitting || bridgeInsufficient || !bridgeAmountValid || !!bridgeDestinationError} loading={submitting && !bridgePreviewOpen} />
          </View>
        </Screen>
      )}

      <Sheet visible={previewOpen} onClose={closePreview}>
        {result ? (
          <SwapResultView
            success
            title={t('Swap submitted')}
            body={`Swapping ${amount} ${symbolIn} for ${symbolOut}.`}
            txHash={result.txHash}
            explorerUrl={result.explorerUrl}
            onClose={closePreview}
          />
        ) : submitError ? (
          <SwapResultView
            success={false}
            title={t('Swap failed')}
            body={submitError}
            onRetry={() => setSubmitError('')}
            onClose={closePreview}
          />
        ) : (
          <>
            <Eyebrow style={{ marginBottom: 12 }}>{t('Review swap')}</Eyebrow>
            {!!preview && (
              <Card pad={false}>
                <View style={{ paddingHorizontal: spacing.cardPad }}>
                  <KeyValue first label={t('You pay')} value={`${amount || '0'} ${symbolIn}`} />
                  <KeyValue
                    label={t('You receive')}
                    value={expectedOut ? `â‰ˆ ${expectedOut.toFixed(4)} ${symbolOut}` : symbolOut}
                  />
                  {minReceived !== null && (
                    <KeyValue label={t('Minimum received')} value={`${minReceived.toFixed(4)} ${symbolOut}`} />
                  )}
                  <KeyValue label={t('Slippage')} value={formatBps(slippageBps)} />
                  <KeyValue
                    label="Fee"
                    selectable={false}
                    value={
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                        {swapFee.applied
                          ? `${swapFee.feeAmount} ${symbolIn} + ~${networkFeeQor} QOR `
                          : `~${networkFeeQor} QOR `}
                        <Text style={{ color: colors.accent, fontSize: 11 }}>{feeOpen ? 'â–²' : 'â–¼'}</Text>
                      </Text>
                    }
                    onPress={() => setFeeOpen((open) => !open)}
                  />
                  {feeOpen && (
                    <View
                      style={{
                        backgroundColor: colors.surface,
                        borderRadius: spacing.radiusSm - 4,
                        marginBottom: 10,
                        paddingHorizontal: 12,
                      }}
                    >
                      {swapFee.applied && (
                        <KeyValue
                          first
                          label={`AEGIS fee (${formatBps(swapFeeBps)})`}
                          value={`${swapFee.feeAmount} ${symbolIn}`}
                        />
                      )}
                      <KeyValue
                        first={!swapFee.applied}
                        label="Network fee (est.)"
                        value={`~${networkFeeQor} QOR`}
                      />
                    </View>
                  )}
                  <KeyValue
                    label={t('Price source')}
                    value={
                      preview?.routeStatus?.available
                        ? `QoreChain AMM · Pool #${preview.routeStatus.poolId || poolId}`
                        : t('No pool yet')
                    }
                  />
                </View>
              </Card>
            )}
            {!!preview && !preview.routeStatus?.available && (
              <View style={{ marginTop: 12 }}>
                <Notice
                  text={preview.routeStatus?.detail || 'This pair is not available yet. Swaps will turn on automatically when it is ready.'}
                />
              </View>
            )}
            <View style={{ gap: 10, marginTop: 16 }}>
              <Button
                label={submitting ? t('Submitting…') : t('Confirm swap')}
                onPress={() => setAuthOpen(true)}
                disabled={submitting || !preview?.routeStatus?.available}
                loading={submitting}
              />
              <Button label="Cancel" variant="secondary" onPress={closePreview} />
            </View>
          </>
        )}
      </Sheet>

      <Sheet visible={bridgePreviewOpen} onClose={closeBridgePreview}>
        {bridgeResult ? (
          <SwapResultView success title="Bridge submitted" body={`Sending ${bridgeAmount} ${bridgeAssetSymbol} to ${bridgePreview?.chain?.name || selectedBridgeChain?.name}.`} txHash={bridgeResult.txHash} explorerUrl={bridgeResult.explorerUrl} onClose={closeBridgePreview} />
        ) : bridgeSubmitError ? (
          <SwapResultView success={false} title="Bridge failed" body={bridgeSubmitError} onRetry={() => setBridgeSubmitError('')} onClose={closeBridgePreview} />
        ) : (
          <>
            <Eyebrow style={{ marginBottom: 12 }}>Review transaction</Eyebrow>
            {!!bridgePreview && <Card pad={false}><View style={{ paddingHorizontal: spacing.cardPad }}><KeyValue first label="You send" value={`${bridgeAmount || '0'} ${bridgeAssetSymbol}`} /><KeyValue label="Destination" value={bridgePreview.chain?.name || selectedBridgeChain?.name} /><KeyValue label="Recipient" value={shortAddress(bridgeDestinationAddress, 10, 8)} mono /><KeyValue label="Status" value={bridgePreview.routeStatus?.available ? 'Ready' : 'Coming soon'} /><KeyValue label="Network fee (est.)" value={`~${bridgeNetworkFeeQor} QOR`} /></View></Card>}
            {!!bridgePreview && !bridgePreview.routeStatus?.available && <View style={{ marginTop: 12 }}><Notice text={bridgePreview.routeStatus?.detail || 'Transfers to this network are coming soon.'} /></View>}
            <View style={{ gap: 10, marginTop: 16 }}>
              <Button label={submitting ? 'Submitting...' : 'Confirm bridge'} onPress={() => setBridgeAuthOpen(true)} disabled={submitting || !bridgePreview?.routeStatus?.available} loading={submitting} />
              <Button label="Cancel" variant="secondary" onPress={closeBridgePreview} />
            </View>
          </>
        )}
      </Sheet>

      <SlippageSheet
        visible={slippageOpen}
        onClose={() => setSlippageOpen(false)}
        slippageBps={slippageBps}
        onChange={setSlippageBps}
      />

      <TokenSelectSheet
        visible={!!tokenSelectFor}
        onClose={() => setTokenSelectFor(null)}
        tokens={swapTokens}
        onSelect={(token) => selectToken(tokenSelectFor as 'in' | 'out' | 'bridge', token.denom)}
      />

      <ChainSelectSheet visible={bridgeSelectOpen} chains={bridgeChainOptions} selectedChainId={selectedBridgeChain?.chainId} onClose={() => setBridgeSelectOpen(false)} onSelect={(chain: any) => { setBridgeDestinationChain(chain.chainId); setBridgePreview(null); setBridgeError(''); }} />

      <ContactPickerSheet
        visible={bridgeContactsOpen}
        onClose={() => setBridgeContactsOpen(false)}
        onSelect={(contact: any) => {
          setBridgeDestinationAddress(contact.address);
          setBridgePreview(null);
          setBridgeError('');
        }}
      />

      <AuthGateModal
        visible={authOpen}
        auth={auth}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={() => {
          setAuthOpen(false);
          submitSwap();
        }}
      />

      <AuthGateModal
        visible={bridgeAuthOpen}
        auth={auth}
        onClose={() => setBridgeAuthOpen(false)}
        onAuthenticated={() => {
          setBridgeAuthOpen(false);
          submitBridge();
        }}
      />
    </View>
  );
}

function ModeTabs({ mode, onChange }: { mode: 'swap' | 'bridge'; onChange: (mode: 'swap' | 'bridge') => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 10, borderWidth: 1, flexDirection: 'row', padding: 3 }}>
      {(['swap', 'bridge'] as const).map((item) => {
        const active = mode === item;
        return (
          <Pressable key={item} onPress={() => onChange(item)} style={({ pressed }) => ({ alignItems: 'center', backgroundColor: active ? colors.card : pressed ? colors.cardPressed : 'transparent', borderRadius: 8, flex: 1, paddingVertical: 9 })}>
            <Text style={{ color: active ? colors.text : colors.subtle, fontFamily: active ? fonts.displaySemi : fonts.display, fontSize: 13 }}>{item === 'swap' ? 'Swap' : 'Bridge'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ChainPickerPill({ chain, onPress }: { chain: any; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ alignItems: 'center', backgroundColor: pressed ? colors.cardPressed : colors.surface, borderColor: colors.border, borderRadius: spacing.radiusSm, borderWidth: 1, flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingVertical: 12 })}>
      <ChainAvatar chain={chain} size={32} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 15 }}>{chain?.name || 'Select chain'}</Text>
        <Text style={{ color: colors.subtle, fontSize: 12, marginTop: 2 }}>{chainTypeLabel(chain)}</Text>
      </View>
      <Text style={{ color: colors.subtle, fontSize: 12 }}>Change</Text>
    </Pressable>
  );
}

function ChainSelectSheet({ visible, chains, selectedChainId, onClose, onSelect }: any) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Eyebrow style={{ marginBottom: 10 }}>Select destination</Eyebrow>
      <Card pad={false}>
        <ScrollView style={{ maxHeight: 420 }}>
          {chains.map((chain: any, index: number) => (
            <ListRow
              key={chain.chainId || chain.name}
              first={index === 0}
              leading={<ChainAvatar chain={chain} />}
              title={chain.name || chain.chainId}
              titleRight={
                selectedChainId === chain.chainId ? <Pill label="Selected" tone="accent" /> : undefined
              }
              sub={chainTypeLabel(chain)}
              trailing={
                <Pill label={bridgeAvailabilityLabel(chain.status)} tone={bridgeStatusTone(chain.status) as any} />
              }
              onPress={() => {
                onSelect(chain);
                onClose();
              }}
            />
          ))}
        </ScrollView>
      </Card>
    </Sheet>
  );
}

function SlippageSheet({ visible, onClose, slippageBps, onChange }: any) {
  const { colors } = useTheme();
  const [custom, setCustom] = useState('');
  const presets = [10, 50, 100, 300];

  const customPct = Number.parseFloat(custom.replace(',', '.'));
  const customValid = Number.isFinite(customPct) && customPct > 0 && customPct < 100;
  const veryRisky = customValid && customPct >= 50;

  const applyCustom = () => {
    if (!customValid) return;
    onChange(Math.round(customPct * 100));
    setCustom('');
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Eyebrow style={{ marginBottom: 6 }}>Slippage tolerance</Eyebrow>
      <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
        Your swap fails if the price moves against you by more than this while the transaction
        confirms.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {presets.map((bps) => (
          <Pressable
            key={bps}
            onPress={() => {
              onChange(bps);
              setCustom('');
              onClose();
            }}
            style={{
              alignItems: 'center',
              backgroundColor: slippageBps === bps ? colors.accentSoft : colors.surface,
              borderColor: slippageBps === bps ? colors.accent : colors.border,
              borderRadius: spacing.radiusSm,
              borderWidth: 1,
              flex: 1,
              paddingVertical: 12,
            }}
          >
            <Text
              style={{
                color: slippageBps === bps ? colors.accent : colors.text,
                fontFamily: fonts.displaySemi,
                fontSize: 14,
              }}
            >
              {formatBps(bps)}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.surface,
            borderColor: veryRisky ? colors.negative : colors.border,
            borderRadius: spacing.radiusSm,
            borderWidth: 1,
            flex: 1,
            flexDirection: 'row',
            paddingHorizontal: 14,
          }}
        >
          <SheetTextInput
            style={{
              color: veryRisky ? colors.negative : colors.text,
              flex: 1,
              fontFamily: fonts.displaySemi,
              fontSize: 14,
              paddingVertical: 12,
            }}
            value={custom}
            onChangeText={setCustom}
            placeholder={`Custom · ${formatBps(slippageBps)}`}
            placeholderTextColor={colors.faint}
            keyboardType="decimal-pad"
            onSubmitEditing={applyCustom}
            returnKeyType="done"
          />
          <Text style={{ color: colors.subtle, fontFamily: fonts.mono, fontSize: 13 }}>%</Text>
        </View>
        <Button label="Set" small onPress={applyCustom} disabled={!customValid} />
      </View>

      {veryRisky && (
        <Text style={{ color: colors.negative, fontSize: 12.5, lineHeight: 18, marginTop: 10 }}>
          Very risky: with {customPct.toFixed(1)}% tolerance you could receive up to{' '}
          {customPct.toFixed(1)}% less than quoted. Most swaps need 3% or less.
        </Text>
      )}
      {customValid && !veryRisky && customPct > 5 && (
        <Text style={{ color: colors.warning, fontSize: 12.5, lineHeight: 18, marginTop: 10 }}>
          High tolerance — you may receive noticeably less than quoted.
        </Text>
      )}
    </Sheet>
  );
}

function SwapResultView({ success, title, body, txHash, explorerUrl, onRetry, onClose }: any) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState('');
  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };
  return (
    <View>
      <View style={{ alignItems: 'center', marginBottom: 16, marginTop: 4 }}>
        {success ? (
          <CheckCircle2 color={colors.positive} size={44} strokeWidth={1.8} />
        ) : (
          <XCircle color={colors.negative} size={44} strokeWidth={1.8} />
        )}
        <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 19, marginTop: 12 }}>
          {title}
        </Text>
        <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' }}>
          {body}
        </Text>
        {!!txHash && (
          <Pressable onPress={() => copy('hash', txHash)} style={({ pressed }) => [{ marginTop: 10 }, pressed && { opacity: 0.7 }]}>
            <Text style={{ color: colors.accent, fontFamily: fonts.monoRegular, fontSize: 12 }}>
              {copied === 'hash' ? 'Copied' : shortAddress(txHash, 12, 10)}
            </Text>
          </Pressable>
        )}
      </View>
      <View style={{ gap: 10 }}>
        {!!explorerUrl && (
          <Button
            label={copied === 'explorer' ? 'Link copied' : 'Copy explorer link'}
            variant="secondary"
            onPress={() => copy('explorer', explorerUrl)}
          />
        )}
        {!success && !!onRetry && <Button label="Try again" onPress={onRetry} />}
        <Button label={success ? 'Done' : 'Close'} variant={success ? 'primary' : 'secondary'} onPress={onClose} />
      </View>
    </View>
  );
}

function TokenPickerPill({ symbol, onPress }: { symbol?: string; onPress: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: pressed ? colors.cardPressed : colors.surface,
        borderColor: colors.border,
        borderRadius: 999,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
      })}
    >
      {!!symbol && <TokenIcon symbol={symbol} size={22} />}
      <Text style={{ color: symbol ? colors.text : colors.subtle, fontFamily: fonts.displaySemi, fontSize: 13 }}>
        {symbol || t('Select')}
      </Text>
      <ChevronDown color={colors.subtle} size={14} strokeWidth={2.2} />
    </Pressable>
  );
}
