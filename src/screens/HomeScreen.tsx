import { ArrowLeft, ArrowUp, Bot, Menu, TrendingDown, TrendingUp, WalletMinimal } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, InteractionManager, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { fetchChatHistory, fetchCredits, newConversationId, saveChatStatus, sendAgentMessage, starterPrompts } from '../chatService';
import { getCachedSync, writeCache } from '../dataCache';
import { formatUsdDisplay } from '../format';
import { useWalletAssets } from '../hooks';
import { useI18n } from '../i18n';
import { useNav } from '../nav';
import {
  composeTokenTransfer,
  computeSwapFee,

  fetchWalletAssets,
  fetchAmmRouteStatus,
  fetchQorChange24h,
  maxSendableQor,
  nativeTransferFeeReserve,
  shortAddress,
  submitAmmSwap,
  submitTokenTransfer,
} from '../qoreWallet';
import { useRemoteConfig } from '../remoteConfig';
import { useTheme } from '../ThemeContext';
import { fonts, spacing } from '../theme';
import { AmountText, Button, Card, dismissKeyboardAndWait, Eyebrow, IconBtn, KeyValue, LoadingDots, Notice, Pill, Sheet, useFocusGlow, usePullRefresh } from '../ui';
import { SendReviewScreen } from './AssetsScreens';
import { AuthGateModal } from './AuthScreens';
import { ContactsScreen } from './ContactsScreens';
import { WalletManagerScreen } from './WalletsScreens';

const proposalDenoms: Record<string, string> = { QOR: 'uqor', QUSDT: 'qusdt', USDT: 'qusdt' };

function sameToken(expected: string, proposal: any) {
  const value = String(expected || '').trim().toLowerCase();
  const candidates = [proposal?.asset, proposal?.denom, proposal?.fromToken, proposal?.denomIn]
    .map((item) => String(item || '').trim().toLowerCase());
  return candidates.includes(value) || candidates.includes(`u${value}`) || (value.startsWith('u') && candidates.includes(value.slice(1)));
}

function proposalRequestMismatch(candidate: any, request: string) {
  const text = String(request || '');
  if (candidate?.action === 'transfer') {
    const transferMatch = text.match(/\b(?:send|transfer)\s+(?:of\s+)?(\d+(?:\.\d+)?|\.\d+)(?:\s+([a-z][a-z0-9_./-]*))?/i);
    if (!transferMatch) return '';
    const requested = Number(transferMatch[1]);
    const received = Number(candidate.amount);
    if (!Number.isFinite(received) || Math.abs(requested - received) > 0.000000001) {
      return `The returned proposal amount (${candidate.amount || 'unknown'} ${candidate.asset || 'tokens'}) does not match your latest request (${transferMatch[1]}).`;
    }
    const requestedAsset = ['to', 'token', 'tokens'].includes(String(transferMatch[2] || '').toLowerCase()) ? '' : transferMatch[2] || '';
    if (requestedAsset && !sameToken(requestedAsset, candidate)) {
      return `The returned proposal asset (${candidate.asset || 'unknown'}) does not match the token in your latest request (${requestedAsset}).`;
    }
    const recipientMatch = text.match(/\b(qor1[a-z0-9]{8,}|0x[a-f0-9]{40})\b/i);
    if (recipientMatch && String(candidate.recipient || '').toLowerCase() !== recipientMatch[1].toLowerCase()) {
      return 'The returned proposal recipient does not match the address in your latest request.';
    }
    return '';
  }
  if (candidate?.action === 'swap') {
    const swapMatch = text.match(/\bswap\s+(\d+(?:\.\d+)?|\.\d+)\s+([a-z][a-z0-9_./-]*)\s+(?:to|for)\s+([a-z][a-z0-9_./-]*)/i);
    if (!swapMatch) return '';
    if (Math.abs(Number(swapMatch[1]) - Number(candidate.amount)) > 0.000000001 ||
        !sameToken(swapMatch[2], { asset: candidate.fromToken, denom: candidate.denomIn }) ||
        !sameToken(swapMatch[3], { asset: candidate.toToken, denom: candidate.denomOut })) {
      return 'The returned swap proposal does not match your latest amount or token pair.';
    }
  }
  return '';
}

const greeting = {
  role: 'agent',
  content: 'Aegis is online. Ask about your wallet, a transfer, a swap, or a dapp connection.',
  source: 'local',
};

export function HomeScreen({ wallet, auth, walletOps, walletsKey, contactsKey, newChatKey, openChat, consumeAction, notice, onDismissNotice, onMenu, onTab, selectedNetwork }: any) {
  const { colors } = useTheme();
  const { t, langEnglishName } = useI18n();
  const nav = useNav();
  const { swapEnabled, swapFeeBps, treasuryAddress } = useRemoteConfig();
  const [assetsRefreshKey, setAssetsRefreshKey] = useState(0);
  const { tokens } = useWalletAssets(wallet, selectedNetwork, assetsRefreshKey);
  const refresh = usePullRefresh(() => setAssetsRefreshKey((key) => key + 1));
  const [messages, setMessages] = useState<any[]>([greeting]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [revealingReply, setRevealingReply] = useState(false);
  // Set lazily on the first send of a fresh chat, or when a saved
  // conversation is opened from the side menu.
  const conversationIdRef = useRef<string | null>(null);
  // Seeded from the session cache so the indicator is visible immediately when
  // returning to this tab (fresh value replaces it once fetched).
  const creditsCacheKey = `credits.${wallet?.accounts?.evm?.address || 'none'}`;
  const [credits, setCreditsState] = useState<number | null>(() => getCachedSync(creditsCacheKey) ?? null);
  const setCredits = (value: number) => {
    writeCache(creditsCacheKey, value);
    setCreditsState(value);
  };
  const composerGlow = useFocusGlow();
  const [proposal, setProposal] = useState<any>(null);
  const [proposalError, setProposalError] = useState('');
  const [proposalBalanceIssue, setProposalBalanceIssue] = useState('');
  const [swapAuthOpen, setSwapAuthOpen] = useState(false);
  const [transferAuthOpen, setTransferAuthOpen] = useState(false);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapResult, setSwapResult] = useState<any>(null);
  const [proposalHidden, setProposalHidden] = useState(false);
  const scrollRef = useRef<any>(null);
  const proposalCloseHandledRef = useRef(false);
  const proposalHiddenRef = useRef(false);
  const revealInProgressRef = useRef(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealResolveRef = useRef<(() => void) | null>(null);

  const scrollToLatest = (animated = true) => requestAnimationFrame(() => scrollRef.current?.scrollToEnd?.({ animated }));

  const revealAgentReply = (reply: any) => new Promise<void>((resolve) => {
    const content = String(reply.content || '');
    const revealId = `reply-${Date.now()}-${Math.random()}`;
    const chunkSize = Math.max(10, Math.ceil(content.length / 42));
    let visibleLength = 0;
    revealResolveRef.current = resolve;
    revealInProgressRef.current = true;
    setRevealingReply(true);
    setMessages((current) => [...current, { role: 'agent', content: '', source: reply.source, blocked: reply.blocked, revealId }]);

    const revealNextChunk = () => {
      visibleLength = Math.min(content.length, visibleLength + chunkSize);
      setMessages((current) => current.map((message) => (
        message.revealId === revealId ? { ...message, content: content.slice(0, visibleLength) } : message
      )));
      if (visibleLength < content.length) {
        revealTimerRef.current = setTimeout(revealNextChunk, 16);
        return;
      }
      revealInProgressRef.current = false;
      revealTimerRef.current = null;
      revealResolveRef.current = null;
      setRevealingReply(false);
      resolve();
    };
    revealNextChunk();
  });

  const appendProposalStatus = (title: string, detail: string, tone: 'success' | 'error' | 'neutral') => {
    const statusCard = { title, detail, tone };
    setMessages((current) => [
      ...current,
      { role: 'agent', statusCard, source: 'local' },
    ]);
    void saveChatStatus(wallet, conversationIdRef.current, statusCard);
  };

  const hideBusyProposal = () => {
    // The transaction continues; hide only the sheet and suppress its native
    // onDismiss callback from turning this into a cancelled transaction.
    proposalCloseHandledRef.current = true;
    proposalHiddenRef.current = true;
    setProposalHidden(true);
  };

  const finishHiddenProposal = (currentProposal: any, error = '') => {
    if (!proposalHiddenRef.current) return false;
    proposalHiddenRef.current = false;
    setProposalHidden(false);
    setProposal(null);
    setSwapResult(null);
    setProposalError('');
    setProposalBalanceIssue('');
    if (error) {
      appendProposalStatus(
        currentProposal?.action === 'swap' ? 'Swap failed' : 'Transfer failed',
        error,
        'error',
      );
    } else {
      appendProposalStatus(
        currentProposal?.action === 'swap' ? 'Swap submitted' : 'Transfer sent',
        currentProposal?.action === 'swap'
          ? 'Your wallet submitted the transaction for confirmation on QoreChain.'
          : 'Your transfer was sent to QoreChain for confirmation.',
        'success',
      );
    }
    return true;
  };

  const closeProposal = (outcome?: 'dismissed' | 'success') => {
    if (outcome && proposalCloseHandledRef.current) return;
    if (outcome) proposalCloseHandledRef.current = true;
    const currentProposal = proposal;
    setProposal(null);
    proposalHiddenRef.current = false;
    setProposalHidden(false);
    setProposalError('');
    setProposalBalanceIssue('');
    setSwapResult(null);
    setSwapBusy(false);
    if (outcome === 'dismissed' && currentProposal) {
      appendProposalStatus('Transaction dismissed', 'No transaction was signed or submitted.', 'neutral');
    }
    if (outcome === 'success' && currentProposal) {
      appendProposalStatus(
        currentProposal.action === 'swap' ? 'Swap submitted' : 'Transfer sent',
        currentProposal.action === 'swap'
          ? 'Your wallet submitted the transaction for confirmation on QoreChain.'
          : 'Your transfer was sent to QoreChain for confirmation.',
        'success',
      );
    }
  };

  const validateTransferProposalBalance = async (candidate: any) => {
    if (!candidate || candidate.action === 'swap') return '';
    const amount = Number.parseFloat(String(candidate.amount || '0'));
    if (!Number.isFinite(amount) || amount <= 0) return 'The transfer amount is not valid.';
    const assetName = String(candidate.asset || 'QOR');
    const freshTokens = await fetchWalletAssets(wallet, selectedNetwork);
    const asset = freshTokens.find((token: any) =>
      String(token.symbol || '').toUpperCase() === assetName.toUpperCase() ||
      String(token.denom || '').toLowerCase() === String(candidate.denom || '').toLowerCase(),
    );
    const balance = Number.parseFloat(String(asset?.balance || '0'));
    if (!asset || !Number.isFinite(balance) || amount > balance) {
      const available = asset?.balanceDisplay || asset?.balance || '0';
      const symbol = asset?.symbol || assetName;
      return `Insufficient ${symbol} balance. Available: ${available} ${symbol}.`;
    }
    const feeReserve = nativeTransferFeeReserve(selectedNetwork);
    const feeReserveAmount = Number.parseFloat(feeReserve);
    if (asset.denom === 'uqor') {
      const sendable = maxSendableQor(String(asset.balance || '0'), selectedNetwork);
      const maxSendable = Number.parseFloat(sendable);
      if (!Number.isFinite(maxSendable) || amount > maxSendable) {
        return `Insufficient QOR after reserving network fees. Available to send: ${sendable} QOR.`;
      }
    } else {
      const qor = freshTokens.find((token: any) => token.denom === 'uqor');
      if (!qor || Number.parseFloat(String(qor.balance || '0')) < feeReserveAmount) {
        return `Insufficient QOR for network fees. Required reserve: ${feeReserve} QOR.`;
      }
    }
    return '';
  };

  const runSwapProposal = async () => {
    if (!proposal) return;
    setProposalError('');
    setSwapBusy(true);
    try {
      // The server resolves denoms against real pools; fall back to matching
      // the wallet's token list (ticker or pasted denom), then the known map.
      const resolveDenom = (symbolOrDenom: string) => {
        const raw = String(symbolOrDenom || '').trim();
        const upper = raw.toUpperCase();
        const match = tokens.find(
          (token: any) =>
            String(token.symbol).toUpperCase() === upper || token.denom === raw.toLowerCase(),
        );
        if (match) return match.denom;
        if (proposalDenoms[upper]) return proposalDenoms[upper];
        // Looks like an on-chain denom (uqor, factory/qor1.../name) — let the
        // pool lookup be the judge.
        if (/^[a-z][a-z0-9/:._-]{2,}$/.test(raw)) return raw;
        return null;
      };
      const denomIn = proposal.denomIn || resolveDenom(proposal.fromToken);
      const denomOut = proposal.denomOut || resolveDenom(proposal.toToken);
      if (!denomIn || !denomOut) {
        throw new Error(
          `${!denomIn ? proposal.fromToken : proposal.toToken} isn't in your wallet yet — import it from the Assets screen first, or paste its on-chain denom.`,
        );
      }

      const { netAmount } = computeSwapFee(String(proposal.amount || '0'), swapFeeBps, treasuryAddress);
      const route = await fetchAmmRouteStatus({
        networkKey: selectedNetwork,
        poolId: '1',
        denomIn,
        denomOut,
        amountIn: netAmount,
      });
      if (!route.available) {
        throw new Error(route.detail || 'This pair has no active pool yet.');
      }

      const outBase = route.quote?.amount_out ?? route.quote?.amountOut;
      const slippageBps = Math.round((Number.parseFloat(proposal.slippage || '0.5') || 0.5) * 100);
      let minOut = '1';
      try {
        if (outBase) minOut = String((BigInt(String(outBase)) * BigInt(10000 - slippageBps)) / BigInt(10000));
      } catch {}

      const result = await submitAmmSwap({
        mnemonic: wallet.mnemonic,
        amountIn: String(proposal.amount || '0'),
        denomIn,
        denomOut,
        minOut,
        poolId: route.poolId || '1',
        networkKey: selectedNetwork,
        feeBps: swapFeeBps,
        treasuryAddress,
      });
      if (!finishHiddenProposal(proposal)) setSwapResult(result);
    } catch (caught: any) {
      const error = caught?.message || 'Swap failed.';
      if (!finishHiddenProposal(proposal, error)) setProposalError(error);
    } finally {
      setSwapBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    // Auth headers require a one-time key derivation that blocks the JS
    // thread; wait for the screen transition to settle before kicking it off.
    // Entering this tab always shows the dashboard — saved conversations are
    // reopened from the side menu, not force-loaded here.
    const task = InteractionManager.runAfterInteractions(() => {
      if (!active) return;
      fetchCredits(wallet).then((remaining) => {
        if (active && remaining !== null) setCredits(remaining);
      });
    });
    return () => {
      active = false;
      task.cancel();
    };
  }, [wallet]);

  // Side menu → recent chat: load that conversation's messages and continue it.
  useEffect(() => {
    if (!openChat?.key || !openChat?.id) return;
    let active = true;
    conversationIdRef.current = openChat.id;
    setMessages([greeting, { role: 'agent', content: t('Loading chat…'), source: 'local' }]);
    fetchChatHistory(wallet, openChat.id).then((rows) => {
      if (!active || conversationIdRef.current !== openChat.id) return;
      setMessages(
        rows.length
          ? [greeting, ...rows]
          : [greeting, { role: 'agent', content: t('Could not load that chat — check your connection and try again.'), source: 'error' }],
      );
      consumeAction?.('chat');
      setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: false }), 50);
    });
    return () => {
      active = false;
    };
  }, [openChat?.key]);

  const openWalletManager = async () => {
    await dismissKeyboardAndWait();
    nav.push(
      <WalletManagerScreen
        walletOps={walletOps}
        auth={auth}
        selectedNetwork={selectedNetwork}
        onGoHome={() => nav.popAll()}
      />,
    );
  };

  // Side-menu entries land on this tab and push their screens. Each key is
  // consumed immediately — tab screens remount on every switch, and an
  // unconsumed key would re-trigger the push.
  useEffect(() => {
    if (walletsKey) {
      consumeAction?.('wallets');
      openWalletManager();
    }
  }, [walletsKey]);

  useEffect(() => {
    if (contactsKey) {
      consumeAction?.('contacts');
      nav.push(<ContactsScreen />);
    }
  }, [contactsKey]);

  const startNewChat = () => {
    conversationIdRef.current = null;
    setMessages([greeting]);
    setInput('');
    closeProposal();
  };

  useEffect(() => {
    if (!newChatKey) return;
    startNewChat();
  }, [newChatKey]);

  const outOfCredits = credits === 0;

  const send = async (text = input) => {
    const clean = text.trim();
    if (!clean || loading || revealInProgressRef.current) return;
    if (outOfCredits) {
      setInput('');
      setMessages((current) => [
        ...current,
        { role: 'user', content: clean, source: 'local' },
        {
          role: 'agent',
          content: t('Credits exhausted. Retry at 00:00 UTC.'),
          source: 'local',
        },
      ]);
      return;
    }
    setInput('');
    const userMessage = { role: 'user', content: clean, source: 'local' };
    setMessages((current) => [...current, userMessage]);
    setLoading(true);
    if (!conversationIdRef.current) conversationIdRef.current = newConversationId();
    try {
      const reply = await sendAgentMessage({
        text: clean,
        history: messages,
        wallet,
        conversationId: conversationIdRef.current,
        language: langEnglishName,
        selectedNetwork,
        swapEnabled,
      });
      if (reply.conversationId) conversationIdRef.current = reply.conversationId;
      await revealAgentReply(reply);
      if (typeof reply.creditsRemaining === 'number') setCredits(reply.creditsRemaining);
      if (reply.proposal && !reply.proposal.disabled) {
        const requestMismatch = proposalRequestMismatch(reply.proposal, clean);
        if (requestMismatch) {
          appendProposalStatus('Proposal needs correction', requestMismatch, 'error');
          return;
        }
        const balanceIssue = await validateTransferProposalBalance(reply.proposal);
        await dismissKeyboardAndWait();
        setProposalError('');
        setProposalBalanceIssue(balanceIssue);
        proposalCloseHandledRef.current = false;
        proposalHiddenRef.current = false;
        setProposalHidden(false);
        setProposal(reply.proposal);
      }
    } catch (caught: any) {
      setMessages((current) => [
        ...current,
        { role: 'agent', content: caught?.message || 'Aegis could not complete that request.', source: 'error' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const runTransferProposal = async () => {
    if (!proposal) return;
    setProposalError('');
    setSwapBusy(true);
    try {
      const balanceIssue = await validateTransferProposalBalance(proposal);
      if (balanceIssue) {
        setProposalBalanceIssue(balanceIssue);
        return;
      }
      setProposalBalanceIssue('');
      const availableTokens = await fetchWalletAssets(wallet, selectedNetwork);
      const token = availableTokens.find((item: any) =>
        String(item.symbol || '').toLowerCase() === String(proposal.asset || '').toLowerCase() ||
        String(item.denom || '').toLowerCase() === String(proposal.denom || proposal.asset || '').toLowerCase(),
      );
      if (!token) throw new Error(`The requested asset (${proposal.asset || proposal.denom || 'unknown'}) is not available in this wallet.`);
      const result = await submitTokenTransfer({
        mnemonic: wallet.mnemonic,
        token,
        toAddress: proposal.recipient,
        amount: String(proposal.amount || '0'),
        networkKey: selectedNetwork,
      });
      if (!finishHiddenProposal(proposal)) setSwapResult(result);
    } catch (caught: any) {
      const error = caught?.message || 'Transfer failed.';
      if (!finishHiddenProposal(proposal, error)) setProposalError(error);
    } finally {
      setSwapBusy(false);
    }
  };
  const visibleMessages = messages.length > 1 ? messages.slice(1) : [];
  const inChat = visibleMessages.length > 0;

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!inChat || nav.depth > 0) return false;
      Keyboard.dismiss();
      startNewChat();
      return true;
    });
    return () => subscription.remove();
  }, [inChat, nav.depth]);

  // This listener only repositions chat content after Android has finished
  // resizing the viewport. It never changes the composer itself.
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => scrollToLatest(false));
    return () => subscription.remove();
  }, []);

  useEffect(() => () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealInProgressRef.current = false;
    revealResolveRef.current?.();
    revealResolveRef.current = null;
  }, []);

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
        {inChat ? (
          // Inside a chat the drawer icon gives way to a back arrow — the
          // thread stays saved on the server and reopens from the side menu.
          <IconBtn
            onPress={async () => {
              await dismissKeyboardAndWait();
              startNewChat();
            }}
          >
            <ArrowLeft color={colors.text} size={20} strokeWidth={2.2} />
          </IconBtn>
        ) : (
          <IconBtn onPress={onMenu}>
            <Menu color={colors.text} size={20} strokeWidth={2.2} />
          </IconBtn>
        )}
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
          {/* Remaining daily chat credits now live in the side menu; the header
              only carries navigation. `credits` is still tracked here to gate
              sending and to seed the side-menu cache. */}
          {!inChat && <IconBtn onPress={openWalletManager}>
            <WalletMinimal color={colors.text} size={18} strokeWidth={2.2} />
          </IconBtn>}
        </View>
      </View>

      {!!notice && (
        <View style={{ paddingHorizontal: spacing.screen }}>
          <Notice text={notice} onPress={onDismissNotice} />
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: 16, paddingHorizontal: spacing.screen, paddingTop: 6 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={refresh as any}
        onContentSizeChange={() => scrollToLatest(false)}
        onLayout={() => scrollToLatest(false)}
      >
        {/* Tapping anywhere outside the composer blurs it; buttons and
            suggestion cards still receive their own touches first. */}
        <Pressable onPress={Keyboard.dismiss} accessible={false}>
        {visibleMessages.length === 0 ? (
          <Dashboard tokens={tokens} send={send} onTab={onTab} selectedNetwork={selectedNetwork} />
        ) : (
          <View>
            {visibleMessages.map((message: any, index: number) => (
              <MessageBubble key={`${message.role}-${index}`} message={message} />
            ))}
            {loading && !revealingReply && <MessageBubble message={{ role: 'agent', loading: true }} />}
          </View>
        )}
        {visibleMessages.length === 0 && loading && !revealingReply && (
          <MessageBubble message={{ role: 'agent', loading: true }} />
        )}
        </Pressable>
      </ScrollView>

      <View
        style={{
          alignItems: 'flex-end',
          flexDirection: 'row',
          gap: 10,
          paddingBottom: 12,
          paddingHorizontal: spacing.screen,
        }}
      >
        <TextInput
          style={[
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: 24,
              borderWidth: 1,
              color: colors.text,
              flex: 1,
              fontSize: 15,
              maxHeight: 120,
              minHeight: 48,
              paddingHorizontal: 18,
              paddingVertical: 13,
            },
            composerGlow.style,
          ]}
          {...composerGlow.inputProps}
          value={input}
          onChangeText={setInput}
          placeholder={t('Ask Aegis anything...')}
          placeholderTextColor={colors.faint}
          editable
          multiline
        />
        <Pressable
          onPress={() => send()}
          disabled={!input.trim()}
          style={({ pressed }) => ({
            alignItems: 'center',
            backgroundColor: input.trim() ? colors.primary : colors.surface,
            borderColor: input.trim() ? colors.primary : colors.border,
            borderRadius: 24,
            borderWidth: 1,
            height: 48,
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
            width: 48,
          })}
        >
          <ArrowUp color={input.trim() ? colors.onPrimary : colors.faint} size={20} strokeWidth={2.4} />
        </Pressable>
      </View>

      <Sheet
        visible={Boolean(proposal) && !proposalHidden}
        onClose={swapBusy ? hideBusyProposal : () => closeProposal('dismissed')}
      >
        {!!proposal && swapResult ? (
          <View>
            <View style={{ alignItems: 'center', marginBottom: 16, marginTop: 4 }}>
              <Text style={{ color: colors.positive, fontFamily: fonts.display, fontSize: 19 }}>
                {proposal.action === 'swap' ? 'Swap submitted' : 'Transfer sent'}
              </Text>
              <Text style={{ color: colors.subtle, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
                {proposal.action === 'swap'
                  ? proposal.description
                  : `Sent ${proposal.amount} ${proposal.asset || 'QOR'} to ${shortAddress(proposal.recipient, 12, 10)}`}
              </Text>
              {!!swapResult.txHash && (
                <Text style={{ color: colors.accent, fontFamily: fonts.monoRegular, fontSize: 12, marginTop: 10 }}>
                  {shortAddress(swapResult.txHash, 12, 10)}
                </Text>
              )}
            </View>
            <Button label="Done" onPress={() => closeProposal('success')} />
          </View>
        ) : !!proposal && (
          <>
            <Eyebrow style={{ marginBottom: 6 }}>
              {proposal.action === 'swap' ? 'Swap proposal' : 'Transfer proposal'}
            </Eyebrow>
            <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 19, marginBottom: 5 }}>
              {proposal.action === 'swap'
                ? proposal.description || 'Review this swap'
                : `Send ${proposal.amount} ${proposal.asset || 'QOR'}`}
            </Text>
            {proposal.action !== 'swap' && (
              <Text style={{ color: colors.subtle, fontFamily: fonts.monoRegular, fontSize: 12, marginBottom: 14 }}>
                To {shortAddress(proposal.recipient, 12, 10)}
              </Text>
            )}
            <Card pad={false}>
              <View style={{ paddingHorizontal: spacing.cardPad }}>
                {proposal.action === 'swap' ? (
                  <>
                    <KeyValue first label="You pay" value={`${proposal.amount} ${proposal.fromToken}`} />
                    <KeyValue label="You receive" value={proposal.toToken} />
                    {!!proposal.slippage && <KeyValue label="Slippage" value={`${proposal.slippage}%`} />}
                    {(() => {
                      const fee = computeSwapFee(String(proposal.amount || '0'), swapFeeBps, treasuryAddress);
                      return (
                        <KeyValue
                          label="Fee"
                          value={
                            fee.applied
                              ? `${fee.feeAmount} ${proposal.fromToken} + network gas`
                              : 'Network gas only'
                          }
                        />
                      );
                    })()}
                  </>
                ) : (
                  <>
                    <KeyValue first label="Amount" value={`${proposal.amount} ${proposal.asset || 'QOR'}`} />
                    <KeyValue label="Recipient" value={shortAddress(proposal.recipient, 12, 10)} mono />
                    {!!proposal.lane && <KeyValue label="Lane" value={proposal.lane} />}
                    <KeyValue label="Network fee reserve" value={`~${nativeTransferFeeReserve(selectedNetwork)} QOR`} />
                  </>
                )}
              </View>
            </Card>
            {!!proposalBalanceIssue && (
              <View style={{ marginTop: 12 }}>
                <Notice text={proposalBalanceIssue} tone="error" />
              </View>
            )}
            {!!proposalError && (
              <View style={{ marginTop: 12 }}>
                <Notice text={proposalError} tone="error" />
              </View>
            )}
            {proposal.action === 'swap' && !swapEnabled && (
              <View style={{ marginTop: 12 }}>
                <Notice text="Swaps are temporarily disabled while QOR pools go live." />
              </View>
            )}
            <View style={{ gap: 10, marginTop: 16 }}>
              {proposal.action === 'swap' ? (
                <Button
                  label={!swapEnabled ? 'Swaps coming soon' : swapBusy ? 'Submitting…' : 'Confirm swap'}
                  onPress={() => setSwapAuthOpen(true)}
                  disabled={!swapEnabled || swapBusy}
                  loading={swapBusy}
                />
              ) : (
                <Button
                  label={proposalBalanceIssue ? 'Insufficient balance' : swapBusy ? 'Submitting…' : 'Confirm transaction'}
                  onPress={() => setTransferAuthOpen(true)}
                  disabled={swapBusy || !!proposalBalanceIssue}
                  loading={swapBusy}
                />
              )}
              <Button label="Dismiss" variant="secondary" onPress={() => closeProposal('dismissed')} disabled={swapBusy} />
            </View>
          </>
        )}
      </Sheet>

      <AuthGateModal
        visible={swapAuthOpen}
        auth={auth}
        onClose={() => setSwapAuthOpen(false)}
        onAuthenticated={() => {
          setSwapAuthOpen(false);
          runSwapProposal();
        }}
      />
      <AuthGateModal
        visible={transferAuthOpen}
        auth={auth}
        onClose={() => setTransferAuthOpen(false)}
        onAuthenticated={() => {
          setTransferAuthOpen(false);
          runTransferProposal();
        }}
      />
    </View>
  );
}

function Dashboard({ tokens, send, onTab, selectedNetwork }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const totalUsd = tokens.reduce(
    (sum: number, token: any) =>
      sum + (Number.parseFloat(String(token.usdValue || '').replace(/[$,]/g, '')) || 0),
    0,
  );

  // 24h trend from locally accrued price snapshots (null until a pool price
  // and ≥1h of history exist — the chip stays hidden until then).
  const [livePct, setLivePct] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    fetchQorChange24h(selectedNetwork).then((pct) => { if (active) setLivePct(pct); }).catch(() => {});
    return () => { active = false; };
  }, [selectedNetwork, tokens]);
  const changePct = Number.isFinite(livePct) ? (livePct as number) : 0;
  const changeUsd = totalUsd * (changePct / 100);
  const up = changePct >= 0;
  const trendColor = changePct === 0 ? colors.subtle : up ? colors.positive : colors.negative;
  const TrendIcon = up ? TrendingUp : TrendingDown;

  return (
    <View style={{ paddingTop: 8 }}>
      <Card
        eyebrow={t('Portfolio')}
        eyebrowRight={<Pill label="ML-DSA-87" tone="accent" />}
        onPress={() => onTab('Wallet')}
      >
        <AmountText size={32}>{formatUsdDisplay(totalUsd)}</AmountText>
        <View style={{ alignItems: 'flex-end', flexDirection: 'row', gap: 12, marginTop: 14 }}>
          <View style={{ flex: 1, gap: 7 }}>
            {/* Chip only renders when there is real movement — no filler text. */}
            {changeUsd !== 0 && (
              <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
                <View
                  style={{
                    alignItems: 'center',
                    backgroundColor: hexAlpha(trendColor, 0.14),
                    borderRadius: 999,
                    flexDirection: 'row',
                    gap: 5,
                    paddingHorizontal: 9,
                    paddingVertical: 4,
                  }}
                >
                  <TrendIcon color={trendColor} size={12} strokeWidth={2.6} />
                  <Text
                    style={{
                      color: trendColor,
                      fontFamily: fonts.mono,
                      fontSize: 11.5,
                      letterSpacing: 0.4,
                    }}
                  >
                    {`${up ? '+' : '−'}${Math.abs(changePct).toFixed(2)}%`}
                  </Text>
                </View>
                <Text style={{ color: colors.text, fontFamily: fonts.monoRegular, fontSize: 12.5 }}>
                  {`${up ? '+' : '−'}$${Math.abs(changeUsd).toFixed(2)}`}
                </Text>
              </View>
            )}
            <Text
              style={{
                color: colors.faint,
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
            >
              {t('Past 24 hours')}
            </Text>
          </View>
          <TrendSparkline changePct={changePct} color={trendColor} />
        </View>
      </Card>

      <View style={{ marginTop: 26 }}>
        <Eyebrow style={{ marginBottom: 12, paddingHorizontal: 2 }}>{t('Suggested')}</Eyebrow>
        <View style={{ gap: 10 }}>
          {starterPrompts.map((prompt: string) => (
            <Pressable
              key={prompt}
              onPress={() => send(t(prompt))}
              style={({ pressed }) => ({
                alignItems: 'center',
                backgroundColor: pressed ? colors.cardPressed : colors.card,
                borderColor: pressed ? colors.accent : colors.border,
                borderRadius: spacing.radiusSm + 2,
                borderWidth: 1,
                flexDirection: 'row',
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 11,
              })}
            >
              <View
                style={{
                  alignItems: 'center',
                  backgroundColor: colors.accentSoft,
                  borderRadius: 9,
                  height: 28,
                  justifyContent: 'center',
                  width: 28,
                }}
              >
                <Bot color={colors.accent} size={14} strokeWidth={2} />
              </View>
              <Text
                style={{
                  color: colors.text,
                  flex: 1,
                  fontFamily: fonts.displaySemi,
                  fontSize: 12.5,
                  lineHeight: 17,
                }}
              >
                {t(prompt)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

/** Blend a hex color onto transparency at the given opacity. */
function hexAlpha(hex: string, alpha: number) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 24h area sparkline: a smooth curve tilted by the day's change, with a
 * gradient wash underneath and a dot marking "now". Flat hairline when
 * there is genuinely no movement.
 */
function TrendSparkline({ changePct, color }: { changePct: number; color: string }) {
  const width = 104;
  const height = 36;
  const pad = 4;
  const tilt = Math.max(-1, Math.min(1, changePct / 5));

  // Fixed waypoints (deterministic, no randomness) shaped like a day of
  // drift; the whole profile leans with the change direction.
  const profile = [0, 0.18, 0.08, 0.42, 0.3, 0.62, 0.5, 0.88, 1];
  const usable = height - pad * 2;
  const points = profile.map((p, index) => {
    const x = (index / (profile.length - 1)) * width;
    const drift = (p - 0.5) * tilt * usable;
    const wiggle = tilt === 0 ? 0 : Math.sin(index * 2.1) * usable * 0.09;
    return [x, height / 2 - drift + wiggle] as [number, number];
  });

  // Midpoint-smoothed path: quadratic segments through each waypoint.
  let path = `M ${points[0][0]} ${points[0][1].toFixed(1)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const [cx, cy] = points[index];
    const mx = (cx + points[index + 1][0]) / 2;
    const my = (cy + points[index + 1][1]) / 2;
    path += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const [lastX, lastY] = points[points.length - 1];
  path += ` L ${lastX} ${lastY.toFixed(1)}`;
  const area = `${path} L ${width} ${height} L 0 ${height} Z`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.22} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {tilt !== 0 && <Path d={area} fill="url(#sparkFill)" />}
      <Path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={lastX - 1.5} cy={lastY} r={5} fill={hexAlpha(color, 0.2)} />
      <Circle cx={lastX - 1.5} cy={lastY} r={2.4} fill={color} />
    </Svg>
  );
}

function AgentMessageText({ content }: { content: string }) {
  const { colors } = useTheme();
  const parts = String(content || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <Text selectable style={{ color: colors.text, fontSize: 14.5, lineHeight: 21 }}>{parts.map((part, index) => {
    const bold = part.startsWith('**') && part.endsWith('**');
    const code = part.startsWith('`') && part.endsWith('`');
    const label = bold ? part.slice(2, -2) : code ? part.slice(1, -1) : part;
    return <Text key={index} style={{ fontFamily: bold ? fonts.displaySemi : code ? fonts.monoRegular : undefined }}>{label}</Text>;
  })}</Text>;
}

function MessageBubble({ message }: any) {
  const { colors } = useTheme();
  if (message.statusCard) {
    const tone = message.statusCard.tone;
    const color = tone === 'success' ? colors.positive : tone === 'error' ? colors.negative : colors.accent;
    return (
      <View
        style={{
          alignSelf: 'flex-start',
          backgroundColor: colors.card,
          borderColor: color,
          borderLeftWidth: 4,
          borderRadius: 14,
          borderWidth: 1,
          marginBottom: 10,
          maxWidth: '88%',
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <Text style={{ color, fontFamily: fonts.displaySemi, fontSize: 13.5 }}>
          {message.statusCard.title}
        </Text>
        <Text style={{ color: colors.subtle, fontSize: 12.5, lineHeight: 18, marginTop: 4 }}>
          {message.statusCard.detail}
        </Text>
      </View>
    );
  }
  const isUser = message.role === 'user';
  return (
    <View
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        backgroundColor: isUser ? colors.primary : colors.card,
        borderColor: isUser ? colors.primary : colors.border,
        borderRadius: 18,
        borderWidth: 1,
        marginBottom: 10,
        maxWidth: '88%',
        paddingHorizontal: 15,
        paddingVertical: 12,
      }}
    >
      {message.loading ? <LoadingDots color={colors.accent} /> : (isUser ? <Text selectable style={{ color: colors.onPrimary, fontSize: 14.5, fontWeight: '600', lineHeight: 21 }}>{message.content}</Text> : <AgentMessageText content={message.content} />)}
    </View>
  );
}
