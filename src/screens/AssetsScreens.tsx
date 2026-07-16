import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookUser,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Menu,
  Plus,
  QrCode,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, Keyboard, Modal, Pressable, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWalletActivity, useWalletAssets, useWalletNfts } from '../hooks';
import { useI18n } from '../i18n';
import { useNav } from '../nav';
import {
  composeTokenTransfer,
  defaultTokens,
  getNetworkConfig,
  isValidWalletAddress,
  lookupDenom,
  maxSendableQor,
  nativeTransferFeeReserve,
  shortAddress,
  submitNftTransfer,
  submitTokenTransfer,
} from '../qoreWallet';
import { formatAmountDisplay, formatUsdDisplay } from '../format';
import { getContacts, recordLocalTx, saveImportedToken, updateLocalTx } from '../walletStorage';
import { suppressAutoLock } from '../authLock';
import { ContactPickerSheet, SaveContactSheet } from './ContactsScreens';
import { useTheme } from '../ThemeContext';
import { fonts, spacing } from '../theme';

const RECENT_ACTIVITY_LIMIT = 5;
import {
  AmountText,
  Button,
  Card,
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
  TokenIcon,
  TokenSelectSheet,
  EmptyState,
  useFocusGlow,
  usePullRefresh,
} from '../ui';
import { AuthGateModal } from './AuthScreens';

function vmKeyForToken(token: any) {
  if (token?.vm === 'EVM') return 'evm';
  if (token?.vm === 'SVM') return 'svm';
  return 'native';
}

export function AssetsScreen({ wallet, auth, selectedNetwork, onMenu, onSwapToken, onOpenBrowser, openActivityKey, consumeAction }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const nav = useNav();
  const [receiveToken, setReceiveToken] = useState<any>(null);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [addressCopied, setAddressCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [assetTab, setAssetTab] = useState<'tokens' | 'nfts'>('tokens');

  const { tokens: walletTokens, error: assetError } = useWalletAssets(wallet, selectedNetwork, refreshKey);
  const { activity, hydrated: activityHydrated } = useWalletActivity(wallet, selectedNetwork, refreshKey);
  const { nfts, hydrated: nftsHydrated } = useWalletNfts(wallet, selectedNetwork, refreshKey);

  // Side-menu "Activity" lands on this tab and opens the full history.
  // Consumed immediately so tab remounts don't re-open it.
  useEffect(() => {
    if (!openActivityKey) return;
    consumeAction?.('activity');
    nav.push(<AllActivityScreen wallet={wallet} activity={activity} selectedNetwork={selectedNetwork} onOpenBrowser={onOpenBrowser} />);
  }, [openActivityKey]);

  const copyAddress = async () => {
    await Clipboard.setStringAsync(wallet.accounts.native.address);
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 2000);
  };

  const primaryToken = walletTokens[0] || defaultTokens[0];
  // Total = sum of every token's USD value (not just the first token's).
  const totalUsd = formatUsdDisplay(
    walletTokens.reduce(
      (sum: number, token: any) =>
        sum + (Number.parseFloat(String(token.usdValue || '').replace(/[$,]/g, '')) || 0),
      0,
    ),
  );

  const openSend = (token: any) => {
    nav.push(
      <SendScreen
        wallet={wallet}
        auth={auth}
        tokens={walletTokens}
        initialToken={token || primaryToken}
        selectedNetwork={selectedNetwork}
        onDone={() => {
          nav.popAll();
          setRefreshKey((key) => key + 1);
        }}
      />,
    );
  };

  const openTokenDetail = (token: any) => {
    nav.push(
      <TokenDetailScreen
        token={token}
        wallet={wallet}
        selectedNetwork={selectedNetwork}
        onSend={() => openSend(token)}
        onReceive={() => setReceiveToken(token)}
        onSwap={
          onSwapToken && !token.erc20Address
            ? () => {
                nav.popAll();
                onSwapToken(token.denom);
              }
            : undefined
        }
      />,
    );
  };

  const openTransaction = (item: any) => {
    nav.push(<TransactionDetailScreen item={item} wallet={wallet} selectedNetwork={selectedNetwork} onOpenBrowser={onOpenBrowser} />);
  };

  const refresh = usePullRefresh(() => setRefreshKey((key) => key + 1));

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
        <IconBtn onPress={onMenu}>
          <Menu color={colors.text} size={20} strokeWidth={2.2} />
        </IconBtn>
      </View>

      <Screen refreshControl={refresh}>
        <Card
          eyebrow={wallet.label || 'Total balance'}
          eyebrowRight={
            <Pressable hitSlop={9} onPress={() => setBalanceVisible((visible) => !visible)}>
              {balanceVisible ? (
                <Eye color={colors.subtle} size={18} strokeWidth={2.2} />
              ) : (
                <EyeOff color={colors.subtle} size={18} strokeWidth={2.2} />
              )}
            </Pressable>
          }
        >
          <AmountText>{balanceVisible ? totalUsd : '••••••'}</AmountText>

          <Pressable
            onPress={copyAddress}
            style={({ pressed }) => ({
              alignItems: 'center',
              backgroundColor: colors.surface,
              borderColor: colors.borderSoft,
              borderRadius: 999,
              borderWidth: 1,
              flexDirection: 'row',
              gap: 8,
              marginTop: 14,
              opacity: pressed ? 0.7 : 1,
              paddingHorizontal: 12,
              paddingVertical: 8,
            })}
          >
            <ShieldCheck color={colors.accent} size={14} />
            <Text
              style={{ color: colors.text, flex: 1, fontFamily: fonts.monoRegular, fontSize: 12 }}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {addressCopied ? 'Copied' : wallet.accounts.native.address}
            </Text>
            {addressCopied ? (
              <Check color={colors.positive} size={14} strokeWidth={2.6} />
            ) : (
              <Copy color={colors.muted} size={14} strokeWidth={2.2} />
            )}
          </Pressable>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <View style={{ flex: 1 }}>
              <Button label={t('Send')} small onPress={() => openSend(primaryToken)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={t('Receive')} small variant="secondary" onPress={() => setReceiveToken(primaryToken)} />
            </View>
          </View>
        </Card>

        {!!assetError && (
          <View style={{ marginTop: 14 }}>
            <Notice text={assetError} tone="error" />
          </View>
        )}

        <View
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: spacing.radiusSm,
            borderWidth: 1,
            flexDirection: 'row',
            marginTop: 20,
            padding: 4,
          }}
        >
          {(['tokens', 'nfts'] as const).map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setAssetTab(tab)}
              style={{
                alignItems: 'center',
                backgroundColor: assetTab === tab ? colors.card : 'transparent',
                borderColor: assetTab === tab ? colors.border : 'transparent',
                borderRadius: spacing.radiusSm - 4,
                borderWidth: 1,
                flex: 1,
                paddingVertical: 9,
              }}
            >
              <Text
                style={{
                  color: assetTab === tab ? colors.text : colors.subtle,
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                {tab === 'tokens' ? t('Tokens') : t('NFTs')}
              </Text>
            </Pressable>
          ))}
        </View>

        {assetTab === 'nfts' ? (
          <NftGrid
            nfts={nfts}
            hydrated={nftsHydrated}
            onOpen={(nft: any) =>
              nav.push(
                <NftDetailScreen
                  nft={nft}
                  wallet={wallet}
                  auth={auth}
                  selectedNetwork={selectedNetwork}
                  onDone={() => {
                    nav.popAll();
                    setRefreshKey((key) => key + 1);
                  }}
                />,
              )
            }
          />
        ) : (
        <>
        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 10,
            marginTop: 22,
            paddingHorizontal: 2,
          }}
        >
          <Eyebrow>{t('Portfolio')}</Eyebrow>
          <IconBtn
            size={32}
            onPress={() =>
              nav.push(
                <ImportTokenScreen
                  selectedNetwork={selectedNetwork}
                  onDone={() => {
                    nav.popAll();
                    setRefreshKey((key) => key + 1);
                  }}
                />,
              )
            }
          >
            <Plus color={colors.text} size={16} strokeWidth={2.2} />
          </IconBtn>
        </View>
        <Card pad={false}>
          {walletTokens.map((token: any, index: number) => (
            <ListRow
              key={token.symbol}
              first={index === 0}
              leading={<TokenIcon symbol={token.symbol} />}
              title={token.symbol}
              titleRight={token.erc20Address ? <Pill label="ERC-20" /> : undefined}
              sub={token.priceLabel || 'Price unavailable'}
              trailing={
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 14, fontVariant: ['tabular-nums'] }}>
                    {balanceVisible ? token.balanceDisplay || token.balance : '••••'}
                  </Text>
                  <Text style={{ color: colors.subtle, fontSize: 12, marginTop: 2 }}>
                    {balanceVisible ? token.usdValue || '—' : '••'}
                  </Text>
                </View>
              }
              onPress={() => openTokenDetail(token)}
            />
          ))}
        </Card>

        <SectionHeader
          title={t('Recent activity')}
          action={activity.length > 0 ? t('View more') : undefined}
          onAction={() =>
            nav.push(<AllActivityScreen wallet={wallet} activity={activity} selectedNetwork={selectedNetwork} onOpenBrowser={onOpenBrowser} />)
          }
        />
        <Card pad={false}>
          {activity.length === 0 ? (
            !activityHydrated ? (
              <EmptyState title="Loading activity…" />
            ) : (
              <EmptyState
                icon={<Wallet color={colors.accent} size={22} strokeWidth={2} />}
                title="Your activity starts here"
                body={`Send ${primaryToken.symbol} to create your first entry.`}
              />
            )
          ) : (
            activity.slice(0, RECENT_ACTIVITY_LIMIT).map((item: any, index: number) => (
              <ActivityRow
                key={item.hash || index}
                item={item}
                first={index === 0}
                onPress={() => openTransaction(item)}
              />
            ))
          )}
        </Card>
        </>
        )}
      </Screen>

      <ReceiveSheet
        visible={Boolean(receiveToken)}
        onClose={() => setReceiveToken(null)}
        wallet={wallet}
        token={receiveToken || primaryToken}
      />
    </View>
  );
}

function ActivityRow({ item, first, onPress }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const outgoing = item.kind
    ? item.kind === 'send' || item.kind === 'swap'
    : /send|sent|transfer|swap/i.test(item.title || '');
  const securityEvent = item.kind === 'security';
  const DirectionIcon = securityEvent ? ShieldCheck : outgoing ? ArrowUpRight : ArrowDownLeft;
  const amountLabel = item.amount
    ? `${outgoing ? '−' : '+'}${item.amount} ${item.symbol || ''}`.trim()
    : securityEvent
      ? ''
      : shortAddress(item.hash, 6, 4);
  return (
    <ListRow
      first={first}
      leading={
        <View style={{ height: 40, width: 40 }}>
          {securityEvent ? (
            <View
              style={{
                alignItems: 'center',
                backgroundColor: colors.accentSoft,
                borderColor: colors.border,
                borderRadius: 20,
                borderWidth: 1,
                height: 40,
                justifyContent: 'center',
                width: 40,
              }}
            >
              <ShieldCheck color={colors.accent} size={20} strokeWidth={2.2} />
            </View>
          ) : (
            <TokenIcon symbol={item.symbol || '?'} size={40} />
          )}
          <View
            style={{
              alignItems: 'center',
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: 9,
              borderWidth: 1,
              bottom: -3,
              height: 18,
              justifyContent: 'center',
              position: 'absolute',
              right: -3,
              width: 18,
            }}
          >
            <DirectionIcon color={securityEvent ? colors.accent : outgoing ? colors.muted : colors.positive} size={11} strokeWidth={2.6} />
          </View>
        </View>
      }
      title={t(item.title)}
      sub={t(item.status)}
      trailing={
        <Text
          style={{
            color: item.amount ? (outgoing ? colors.text : colors.positive) : colors.subtle,
            fontFamily: item.amount ? fonts.displaySemi : fonts.monoRegular,
            fontSize: item.amount ? 13.5 : 11.5,
            fontVariant: ['tabular-nums'],
          }}
        >
          {amountLabel}
        </Text>
      }
      onPress={onPress}
    />
  );
}

export function AllActivityScreen({ wallet, activity: initialActivity, selectedNetwork, onOpenBrowser }: any) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const nav = useNav();
  const [refreshKey, setRefreshKey] = useState(0);
  // Self-fetch so pull-to-refresh has something to reload; the pushed-in
  // snapshot seeds the first paint via the hook's cache.
  const { activity: fetched } = useWalletActivity(wallet, selectedNetwork, refreshKey);
  const activity = wallet ? fetched : initialActivity || [];
  const refresh = usePullRefresh(() => setRefreshKey((key) => key + 1));
  return (
    <PushedScreen title={t('Activity')} onBack={nav.pop} refreshControl={wallet ? refresh : undefined}>
      <Card pad={false}>
        {activity.length === 0 ? (
          <EmptyState
            icon={<Wallet color={colors.accent} size={22} strokeWidth={2} />}
            title="No activity yet"
            body="Your transactions appear here as soon as you send, receive, or swap."
          />
        ) : (
          activity.map((item: any, index: number) => (
            <ActivityRow
              key={item.hash || index}
              item={item}
              first={index === 0}
              onPress={() =>
                nav.push(<TransactionDetailScreen item={item} wallet={wallet} selectedNetwork={selectedNetwork} onOpenBrowser={onOpenBrowser} />)
              }
            />
          ))
        )}
      </Card>
    </PushedScreen>
  );
}

export function TokenDetailScreen({ token: initialToken, wallet, selectedNetwork, onSend, onReceive, onSwap }: any) {
  const { colors } = useTheme();
  const nav = useNav();
  const [refreshKey, setRefreshKey] = useState(0);
  // Pull-to-refresh re-fetches balances/price; falls back to the snapshot.
  const { tokens } = useWalletAssets(wallet, selectedNetwork, refreshKey);
  const token = (selectedNetwork && tokens.find((row: any) => row.denom === initialToken.denom)) || initialToken;
  const refresh = usePullRefresh(() => setRefreshKey((key) => key + 1));
  const vmKey = vmKeyForToken(token);
  const address = wallet.accounts[vmKey].address;

  return (
    <PushedScreen
      title={token.name || token.symbol}
      onBack={nav.pop}
      refreshControl={selectedNetwork ? refresh : undefined}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Send" onPress={onSend} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Receive" variant="secondary" onPress={onReceive} />
          </View>
          {!!onSwap && (
            <View style={{ flex: 1 }}>
              <Button label="Swap" variant="secondary" onPress={onSwap} />
            </View>
          )}
        </View>
      }
    >
      <Card eyebrow="Balance" eyebrowRight={<Pill label={token.vm || 'Native'} />}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 14 }}>
          <TokenIcon symbol={token.symbol} size={48} />
          <View style={{ flex: 1 }}>
            <AmountText size={30}>{`${token.balanceDisplay || formatAmountDisplay(token.balance)} ${token.symbol}`}</AmountText>
            <Text style={{ color: colors.subtle, fontSize: 13, marginTop: 4 }}>
              {token.usdValue || '$0.00'}
            </Text>
          </View>
        </View>
      </Card>

      <SectionHeader title="Market" />
      <Card pad={false}>
        <View style={{ paddingHorizontal: spacing.cardPad }}>
          {/* Real AMM-derived price when a pool exists; honest otherwise. */}
          <KeyValue
            first
            label="Price"
            value={token.priceLabel && token.priceLabel !== 'No price' ? token.priceLabel : 'Not available'}
          />
          <KeyValue label="Market cap" value="Not available" />
          <KeyValue
            label="Total supply"
            value={token.symbol === 'QOR' ? '4,500,000,000 QOR' : 'Not available'}
          />
          <KeyValue label="24h change" value="Not available" />
        </View>
      </Card>

      <SectionHeader title="Token info" />
      <Card pad={false}>
        <View style={{ paddingHorizontal: spacing.cardPad }}>
          <KeyValue first label="Network" value={token.vm || 'Native'} />
          <KeyValue label="Denom" value={token.denom} mono />
          <KeyValue
            label="Address"
            value={shortAddress(address, 12, 10)}
            mono
            onPress={() => Clipboard.setStringAsync(address)}
          />
        </View>
      </Card>
    </PushedScreen>
  );
}

export function TransactionDetailScreen({ item: initialItem, wallet, selectedNetwork, onOpenBrowser }: any) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const nav = useNav();
  const [copied, setCopied] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const network = getNetworkConfig(selectedNetwork);
  // Pull-to-refresh re-reads the activity so a pending tx's status updates
  // here without leaving the screen; falls back to the pushed-in snapshot.
  const { activity } = useWalletActivity(wallet, selectedNetwork, refreshKey);
  const item =
    (wallet && activity.find((row: any) => row.hash && row.hash === initialItem.hash)) || initialItem;
  const refresh = usePullRefresh(() => setRefreshKey((key) => key + 1));
  // Status drives the pill tone: settled → positive, failed/rejected →
  // negative, everything still in-flight → neutral (pending).
  const status = item.status || 'Pending';
  const failed = /fail|error|reject|declin|revert/i.test(status);
  const confirmed = !failed && /confirm|success|complete|settled/i.test(status);
  const statusTone = failed ? 'negative' : confirmed ? 'positive' : 'neutral';
  // Local placeholders do not identify an on-chain transaction. Any other hash,
  // including a failed transaction hash, remains useful in the explorer.
  const hasRealHash = Boolean(item.hash) && !String(item.hash).startsWith('local_');

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const openExplorer = () => {
    if (!item.explorerUrl) return;
    nav.popAll();
    onOpenBrowser?.(item.explorerUrl);
  };

  return (
    <PushedScreen
      title={t(item.title || 'Transaction')}
      onBack={nav.pop}
      refreshControl={wallet ? refresh : undefined}
      footer={
        <>
          {hasRealHash && (
            <Button
              label={copied === 'hash' ? t('Hash copied') : t('Copy transaction hash')}
              onPress={() => copy('hash', item.hash)}
            />
          )}
          {hasRealHash && !!item.explorerUrl && (
            <Button
              label="Open in browser"
              variant="secondary"
              onPress={openExplorer}
            />
          )}
        </>
      }
    >
      <Card eyebrow={t('Status')} eyebrowRight={<Pill label={t(status)} tone={statusTone} />}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 12 }}>
          <TokenIcon symbol={item.symbol || 'QOR'} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 18 }}>
              {item.title}
            </Text>
            {!!item.height && (
              <Text style={{ color: colors.subtle, fontSize: 13, marginTop: 5 }}>
                Included in block {item.height}
              </Text>
            )}
          </View>
        </View>
      </Card>

      <SectionHeader title={t('Details')} />
      <Card pad={false}>
        <View style={{ paddingHorizontal: spacing.cardPad }}>
          {!!item.description && (
            <KeyValue first label={t('Security')} value={t('Quantum key registered')} />
          )}
          {!!item.amount && (
            <KeyValue first={!item.description} label={t('Amount')} value={`${item.amount} ${item.symbol || ''}`.trim()} />
          )}
          {!!item.counterparty && (
            <KeyValue
              first={!item.amount && !item.description}
              label={item.kind === 'receive' ? t('From') : t('To')}
              value={shortAddress(item.counterparty, 12, 10)}
              mono
              onPress={() => copy('counterparty', item.counterparty)}
            />
          )}
          {hasRealHash && (
            <KeyValue
              first={!item.amount && !item.counterparty && !item.description}
              label={t('Hash')}
              value={shortAddress(item.hash, 12, 10)}
              mono
              onPress={openExplorer}
            />
          )}
          {!!item.height && <KeyValue label={t('Block')} value={String(item.height)} mono />}
          <KeyValue label="Network" value={network.shortName} />
          {hasRealHash && !!item.explorerUrl && (
            <KeyValue
              label="Explorer"
              value={item.explorerUrl}
              mono
              onPress={openExplorer}
            />
          )}
        </View>
      </Card>
    </PushedScreen>
  );
}

export function SendScreen({ wallet, auth, tokens = [], initialToken, selectedNetwork, onDone }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const nav = useNav();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState(initialToken);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const amountGlow = useFocusGlow();
  const recipientGlow = useFocusGlow();
  const [error, setError] = useState('');

  const amountNumber = Number.parseFloat(amount || '0');
  const balanceNumber = Number.parseFloat(asset.balance || '0');
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const insufficient = amountValid && amountNumber > balanceNumber;
  const feeReserve = nativeTransferFeeReserve(selectedNetwork);
  const maxNativeSendable = asset.denom === 'uqor' ? maxSendableQor(asset.balance || '0', selectedNetwork) : null;
  const qorForFees = tokens.find((token: any) => token.denom === 'uqor');
  const feeReserveInsufficient = amountValid && (
    asset.denom === 'uqor'
      ? !Number.isFinite(Number.parseFloat(maxNativeSendable || '')) || amountNumber > Number.parseFloat(maxNativeSendable || '0')
      : !qorForFees || Number.parseFloat(String(qorForFees.balance || '0')) < Number.parseFloat(feeReserve)
  );
  const blockedByBalance = insufficient || feeReserveInsufficient;

  const review = () => {
    // Dismiss the keyboard so it doesn't linger over the pushed review screen.
    Keyboard.dismiss();
    setError('');
    if (!amountValid) {
      setError('Enter an amount to send.');
      return;
    }
    if (feeReserveInsufficient) {
      setError(
        asset.denom === 'uqor'
          ? `Insufficient QOR after reserving network fees. Available to send: ${maxNativeSendable} QOR.`
          : `Insufficient QOR for network fees. Required reserve: ${feeReserve} QOR.`,
      );
      return;
    }
    if (insufficient) {
      setError(`Insufficient ${asset.symbol} balance. Available: ${asset.balance} ${asset.symbol}.`);
      return;
    }
    if (!recipient.trim()) {
      setError('Enter a recipient address.');
      return;
    }
    if (!isValidWalletAddress(recipient)) {
      setError(t('Enter a valid QoreChain wallet address.'));
      return;
    }
    try {
      const preview = composeTokenTransfer({
        wallet,
        token: asset,
        toAddress: recipient,
        amount,
        networkKey: selectedNetwork,
      });
      nav.push(
        <SendReviewScreen
          wallet={wallet}
          auth={auth}
          asset={asset}
          amount={amount}
          recipient={recipient}
          preview={preview}
          selectedNetwork={selectedNetwork}
          onDone={onDone || nav.popAll}
        />,
      );
    } catch (caught: any) {
      setError(caught?.message || 'Check the recipient and amount.');
    }
  };

  return (
    <PushedScreen
      title={t('Send')}
      onBack={nav.pop}
      footer={
        <Button
          label={feeReserveInsufficient ? 'Insufficient QOR for fees' : insufficient ? `${t('Insufficient balance')} � ${asset.symbol}` : t('Review transaction')}
          onPress={review}
          disabled={blockedByBalance || !amountValid || !recipient.trim()}
        />
      }
    >
      <Card onPress={() => setAssetPickerOpen(true)}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 12 }}>
          <TokenIcon symbol={asset.symbol} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 16 }}>
              {asset.symbol}
            </Text>
            <Text style={{ color: colors.subtle, fontSize: 12.5, marginTop: 3 }}>
              {t('Available')}: {asset.balanceDisplay || formatAmountDisplay(asset.balance)} {asset.symbol}
            </Text>
          </View>
          <Text style={{ color: colors.subtle, fontFamily: fonts.mono, fontSize: 12 }}>{'>'}</Text>
        </View>
      </Card>

      <SectionHeader title={t('Amount')} />
      <Card style={amountGlow.style}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 12 }}>
          <TextInput
            style={{
              color: blockedByBalance ? colors.negative : colors.text,
              flex: 1,
              fontFamily: fonts.display,
              fontSize: 34,
              letterSpacing: -0.5,
              padding: 0,
            }}
            {...amountGlow.inputProps}
            value={amount}
            onChangeText={(next) => {
              setAmount(next);
              setError('');
            }}
            placeholder="0.00"
            placeholderTextColor={colors.faint}
            keyboardType="decimal-pad"
          />
          <Pressable
            onPress={() => {
              setAmount(asset.denom === 'uqor' ? maxSendableQor(asset.balance || '0', selectedNetwork) : asset.balance || '0');
              setError('');
            }}
            style={({ pressed }) => ({
              backgroundColor: colors.accentSoft,
              borderRadius: 8,
              opacity: pressed ? 0.7 : 1,
              paddingHorizontal: 12,
              paddingVertical: 7,
            })}
          >
            <Text style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1 }}>
              MAX
            </Text>
          </Pressable>
        </View>
        {insufficient && (
          <Text style={{ color: colors.negative, fontSize: 12.5, marginTop: 8 }}>
            {t('Exceeds your balance of')} {asset.balanceDisplay || formatAmountDisplay(asset.balance)} {asset.symbol}.
          </Text>
        )}
        {feeReserveInsufficient && (
          <Text style={{ color: colors.negative, fontSize: 12.5, marginTop: 8 }}>
            {asset.denom === 'uqor'
              ? `Reserve ~${feeReserve} QOR for network fees. Available to send: ${maxNativeSendable} QOR.`
              : `Insufficient QOR for network fees. Required reserve: ${feeReserve} QOR. Available: ${qorForFees?.balanceDisplay || qorForFees?.balance || '0'} QOR.`}
          </Text>
        )}
      </Card>

      <SectionHeader title={t('Recipient')} />
      <Card style={recipientGlow.style}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
          <TextInput
            style={{
              color: colors.text,
              flex: 1,
              fontFamily: fonts.monoRegular,
              fontSize: 13,
              padding: 0,
            }}
            {...recipientGlow.inputProps}
            value={recipient}
            onChangeText={(next) => {
              setRecipient(next);
              setError('');
            }}
            placeholder="qor1… or 0x… address"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <IconBtn size={38} onPress={() => setContactsOpen(true)}>
            <BookUser color={colors.accent} size={18} strokeWidth={2.2} />
          </IconBtn>
          <IconBtn size={38} onPress={() => setScannerOpen(true)}>
            <QrCode color={colors.accent} size={18} strokeWidth={2.2} />
          </IconBtn>
        </View>
      </Card>

      {!!error && (
        <View style={{ marginTop: 14 }}>
          <Notice text={error} tone="error" />
        </View>
      )}

      <TokenSelectSheet
        visible={assetPickerOpen}
        onClose={() => setAssetPickerOpen(false)}
        tokens={tokens}
        onSelect={(next) => {
          setAsset(next);
          setError('');
        }}
      />
      <ScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onUse={(value: string) => {
          setRecipient(value);
          setScannerOpen(false);
        }}
      />
      <ContactPickerSheet
        visible={contactsOpen}
        onClose={() => setContactsOpen(false)}
        onSelect={(contact: any) => {
          setRecipient(contact.address);
          setError('');
        }}
      />
    </PushedScreen>
  );
}

export function SendReviewScreen({ wallet, auth, asset, amount, recipient, preview, selectedNetwork, onDone }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const nav = useNav();
  const [status, setStatus] = useState<'review' | 'pending' | 'success' | 'failed'>('review');
  const [authOpen, setAuthOpen] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [saveContactOpen, setSaveContactOpen] = useState(false);
  const [isKnownContact, setIsKnownContact] = useState(true);

  // Offer "save to contacts" on success only for addresses we don't know yet.
  useEffect(() => {
    if (!result) return;
    getContacts()
      .then((list) => setIsKnownContact(list.some((contact: any) => contact.address === recipient)))
      .catch(() => {});
  }, [result]);

  const submitTransfer = async () => {
    setError('');
    // Show the pending state immediately after auth; the broadcast waits for
    // the on-chain commit, then flips to success or failed.
    setStatus('pending');
    // Track locally so this send appears in Activity as pending → success/failed
    // even if it fails at broadcast (and so never reaches on-chain history).
    const localId = `local_${Date.now()}`;
    const address = wallet.accounts?.native?.address;
    recordLocalTx(selectedNetwork, address, {
      id: localId,
      kind: 'send',
      title: 'Sent',
      symbol: asset.symbol,
      amount,
      counterparty: recipient,
      status: 'Pending',
    }).catch(() => {});
    // Let the pending panel actually PAINT before the CPU-heavy PQC signing
    // blocks the JS thread — otherwise "pending" only appears seconds later,
    // when signing finishes, and looks like a freeze.
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      const res = await submitTokenTransfer({
        mnemonic: wallet.mnemonic,
        token: asset,
        toAddress: recipient,
        amount,
        networkKey: selectedNetwork,
      });
      setResult(res);
      setStatus('success');
      updateLocalTx(selectedNetwork, address, localId, {
        status: 'Success',
        hash: res?.txHash,
        explorerUrl: res?.explorerUrl,
      }).catch(() => {});
    } catch (caught: any) {
      setError(caught?.message || 'Transfer broadcast failed.');
      setStatus('failed');
      updateLocalTx(selectedNetwork, address, localId, { status: 'Failed' }).catch(() => {});
    }
  };

  const title =
    status === 'success'
      ? t('Transfer sent')
      : status === 'failed'
        ? t('Transfer failed')
        : status === 'pending'
          ? t('Transaction pending')
          : t('Review');

  return (
    <PushedScreen
      title={title}
      onBack={status === 'pending' || status === 'success' ? onDone : nav.pop}
      footer={
        status === 'success' ? (
          <>
            {!isKnownContact && (
              <Button
                label={t('Save recipient to contacts')}
                variant="secondary"
                onPress={() => setSaveContactOpen(true)}
              />
            )}
            <Button label={t('Done')} onPress={onDone} />
          </>
        ) : status === 'pending' ? (
          // The transfer keeps confirming in the background; Done just leaves.
          <Button label={t('Done')} onPress={onDone} />
        ) : status === 'failed' ? (
          <>
            <Button label={t('Try again')} onPress={() => setStatus('review')} />
            <Button label={t('Back')} variant="secondary" onPress={nav.pop} />
          </>
        ) : (
          <Button label={t('Confirm transfer')} onPress={() => setAuthOpen(true)} />
        )
      }
    >
      {status !== 'review' ? (
        <TransferResultPanel
          status={status}
          amount={amount}
          symbol={asset.symbol}
          recipient={recipient}
          errorText={error}
          txHash={result?.txHash}
          explorerUrl={result?.explorerUrl}
          network={result?.network}
        />
      ) : (
        <>
          <Card>
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <TokenIcon symbol={asset.symbol} size={44} />
              <AmountText size={30} style={{ marginTop: 12 }}>
                {`${amount} ${asset.symbol}`}
              </AmountText>
              <Text style={{ color: colors.subtle, fontSize: 13, marginTop: 6 }}>
                to {shortAddress(recipient, 10, 8)}
              </Text>
            </View>
          </Card>

          <SectionHeader title={t('Details')} />
          <Card pad={false}>
            <View style={{ paddingHorizontal: spacing.cardPad }}>
              <KeyValue first label={t('Asset')} value={asset.symbol} />
              <KeyValue label={t('Recipient')} value={recipient} mono />
              <KeyValue label="Lane" value={preview.kind} />
              <KeyValue label="Network" value={getNetworkConfig(selectedNetwork).shortName} />
            </View>
          </Card>
        </>
      )}

      <AuthGateModal
        visible={authOpen}
        auth={auth}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={() => {
          setAuthOpen(false);
          submitTransfer();
        }}
      />
      <SaveContactSheet
        visible={saveContactOpen}
        onClose={() => setSaveContactOpen(false)}
        address={recipient}
        onSaved={() => setIsKnownContact(true)}
      />
    </PushedScreen>
  );
}

function TransferResultPanel({ status, amount, symbol, recipient, errorText, txHash, explorerUrl, network }: any) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const success = status === 'success';
  const pending = status === 'pending';
  return (
    <View>
      <View style={{ alignItems: 'center', marginBottom: 22, marginTop: 24 }}>
        {pending ? (
          <Clock color={colors.warning} size={52} strokeWidth={1.6} />
        ) : success ? (
          <CheckCircle2 color={colors.positive} size={52} strokeWidth={1.6} />
        ) : (
          <XCircle color={colors.negative} size={52} strokeWidth={1.6} />
        )}
        <AmountText size={26} style={{ marginTop: 16 }}>
          {`${amount} ${symbol}`}
        </AmountText>
        <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: 'center' }}>
          {pending
            ? `Sending to ${shortAddress(recipient, 10, 8)} — confirming on-chain…`
            : success
              ? `Sent to ${shortAddress(recipient, 10, 8)}`
              : errorText || 'The transfer could not be broadcast.'}
        </Text>
      </View>
      {(success || pending) && (
        <Card pad={false}>
          <View style={{ paddingHorizontal: spacing.cardPad }}>
            <KeyValue first label={t('Status')} value={pending ? t('Pending') : t('Confirmed')} />
            {!!network && <KeyValue label="Network" value={network} />}
            {!!txHash && (
              <KeyValue
                label={t('Tx hash')}
                value={shortAddress(txHash, 12, 10)}
                mono
                onPress={() => Clipboard.setStringAsync(txHash)}
              />
            )}
            {!!explorerUrl && (
              <KeyValue
                label="Explorer"
                value={explorerUrl}
                mono
                onPress={() => Clipboard.setStringAsync(explorerUrl)}
              />
            )}
          </View>
        </Card>
      )}
    </View>
  );
}

function NftGrid({ nfts, hydrated, onOpen }: any) {
  const { colors } = useTheme();
  if (nfts.length === 0) {
    return (
      <View style={{ marginTop: 12 }}>
        <Card pad={false}>
          {!hydrated ? (
            <EmptyState title="Loading NFTs…" />
          ) : (
            <EmptyState
              icon={<ImageIcon color={colors.accent} size={22} strokeWidth={2} />}
              title="No NFTs yet"
              body="Collectibles sent to your native address appear here automatically."
            />
          )}
        </Card>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
      {nfts.map((nft: any) => (
        <Pressable
          key={`${nft.classId}-${nft.id}`}
          onPress={() => onOpen(nft)}
          style={({ pressed }) => ({
            backgroundColor: pressed ? colors.cardPressed : colors.card,
            borderColor: colors.border,
            borderRadius: spacing.radiusSm + 2,
            borderWidth: 1,
            overflow: 'hidden',
            width: '47.8%',
          })}
        >
          <NftImage uri={nft.uri} />
          <View style={{ padding: 12 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 13.5 }} numberOfLines={1}>
              {nft.name}
            </Text>
            <Text style={{ color: colors.subtle, fontFamily: fonts.monoRegular, fontSize: 11, marginTop: 3 }} numberOfLines={1}>
              {nft.classId}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function NftImage({ uri, height = 140 }: any) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View style={{ alignItems: 'center', backgroundColor: colors.surface, height, justifyContent: 'center' }}>
        <ImageIcon color={colors.faint} size={30} strokeWidth={1.6} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ backgroundColor: colors.surface, height, width: '100%' }}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

export function NftDetailScreen({ nft, wallet, auth, selectedNetwork, onDone }: any) {
  const { colors } = useTheme();
  const nav = useNav();
  const [recipient, setRecipient] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      setResult(
        await submitNftTransfer({
          mnemonic: wallet.mnemonic,
          classId: nft.classId,
          id: nft.id,
          toAddress: recipient,
          networkKey: selectedNetwork,
        }),
      );
    } catch (caught: any) {
      setError(caught?.message || 'NFT transfer failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PushedScreen
      title={result ? 'NFT sent' : nft.name}
      onBack={result ? onDone : nav.pop}
      footer={
        result ? (
          <Button label="Done" onPress={onDone} />
        ) : (
          <Button
            label={submitting ? 'Sending…' : 'Send NFT'}
            onPress={() => setAuthOpen(true)}
            disabled={submitting || !recipient.trim()}
            loading={submitting}
          />
        )
      }
    >
      {result ? (
        <View style={{ alignItems: 'center', marginTop: 24 }}>
          <CheckCircle2 color={colors.positive} size={52} strokeWidth={1.6} />
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 20, marginTop: 14 }}>
            {nft.name} sent
          </Text>
          <Text style={{ color: colors.subtle, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
            Sent to {shortAddress(recipient, 10, 8)}
          </Text>
          {!!result.txHash && (
            <Pressable
              onPress={() => Clipboard.setStringAsync(result.txHash)}
              style={({ pressed }) => [{ marginTop: 10 }, pressed && { opacity: 0.7 }]}
            >
              <Text style={{ color: colors.accent, fontFamily: fonts.monoRegular, fontSize: 12 }}>
                {shortAddress(result.txHash, 12, 10)}
              </Text>
            </Pressable>
          )}
        </View>
      ) : (
        <>
          <Card pad={false}>
            <NftImage uri={nft.uri} height={220} />
            <View style={{ paddingHorizontal: spacing.cardPad }}>
              <KeyValue first label="Collection" value={nft.classId} mono />
              <KeyValue label="Token ID" value={String(nft.id)} mono />
              {!!nft.uri && (
                <KeyValue label="URI" value={nft.uri} mono onPress={() => Clipboard.setStringAsync(nft.uri)} />
              )}
            </View>
          </Card>

          <SectionHeader title="Send to" />
          <Card>
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
              <TextInput
                style={{ color: colors.text, flex: 1, fontFamily: fonts.monoRegular, fontSize: 13, padding: 0 }}
                value={recipient}
                onChangeText={setRecipient}
                placeholder="qor1… recipient address"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <IconBtn size={38} onPress={() => setScannerOpen(true)}>
                <QrCode color={colors.accent} size={18} strokeWidth={2.2} />
              </IconBtn>
            </View>
          </Card>

          {!!error && (
            <View style={{ marginTop: 14 }}>
              <Notice text={error} tone="error" />
            </View>
          )}
        </>
      )}

      <ScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onUse={(value: string) => {
          setRecipient(value);
          setScannerOpen(false);
        }}
      />
      <AuthGateModal
        visible={authOpen}
        auth={auth}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={() => {
          setAuthOpen(false);
          submit();
        }}
      />
    </PushedScreen>
  );
}

export function ImportTokenScreen({ selectedNetwork, onDone }: any) {
  const { colors } = useTheme();
  const nav = useNav();
  const [denom, setDenom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<any>(null);
  const [added, setAdded] = useState(false);

  const lookUp = async () => {
    setError('');
    setFound(null);
    setBusy(true);
    try {
      const token = await lookupDenom(denom, selectedNetwork);
      if (!token.exists) {
        setError(`No token with denom "${token.denom}" was found on this network.`);
      } else {
        setFound(token);
      }
    } catch (caught: any) {
      setError(caught?.message || 'Could not look up that denom.');
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!found) return;
    setBusy(true);
    try {
      await saveImportedToken(selectedNetwork, {
        symbol: found.symbol,
        name: found.name,
        denom: found.denom,
        decimals: found.decimals,
        ...(found.kind === 'erc20'
          ? { erc20Address: found.erc20Address, vm: 'EVM', tag: 'ERC-20', addressModes: ['EVM'] }
          : { vm: 'Native', tag: 'Imported', addressModes: ['Native'] }),
        balance: '0',
        priceLabel: 'No price',
        usdValue: '$0.00',
      });
      setAdded(true);
    } catch (caught: any) {
      setError(caught?.message || 'Could not save the token.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PushedScreen
      title="Import token"
      onBack={added ? onDone : nav.pop}
      footer={
        added ? (
          <Button label="Done" onPress={onDone} />
        ) : found ? (
          <Button label={busy ? 'Adding…' : `Add ${found.symbol}`} onPress={add} disabled={busy} loading={busy} />
        ) : (
          <Button
            label={busy ? 'Looking up…' : 'Look up token'}
            onPress={lookUp}
            disabled={busy || !denom.trim()}
            loading={busy}
          />
        )
      }
    >
      {added ? (
        <View style={{ alignItems: 'center', marginTop: 32 }}>
          <CheckCircle2 color={colors.positive} size={52} strokeWidth={1.6} />
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 20, marginTop: 14 }}>
            {found.symbol} added
          </Text>
          <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' }}>
            {found.name} now appears in your portfolio and send options.
          </Text>
        </View>
      ) : (
        <>
          <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
            Native tokens you receive are detected automatically. Enter a native denom (e.g.
            "qusdt") or a 0x contract address for an EVM-lane token.
          </Text>
          <Card>
            <TextInput
              style={{ color: colors.text, fontFamily: fonts.monoRegular, fontSize: 14, padding: 0 }}
              value={denom}
              onChangeText={(next) => {
                setDenom(next);
                setFound(null);
                setError('');
              }}
              placeholder="Denom or 0x contract address"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={lookUp}
              returnKeyType="search"
            />
          </Card>

          {!!error && (
            <View style={{ marginTop: 14 }}>
              <Notice text={error} tone="error" />
            </View>
          )}

          {!!found && (
            <>
              <SectionHeader title="Token found" />
              <Card pad={false}>
                <ListRow
                  first
                  leading={<TokenIcon symbol={found.symbol} />}
                  title={found.symbol}
                  titleRight={found.kind === 'erc20' ? <Pill label="ERC-20" /> : undefined}
                  sub={found.name}
                />
                <View style={{ paddingHorizontal: spacing.cardPad }}>
                  <KeyValue
                    label={found.kind === 'erc20' ? 'Contract' : 'Denom'}
                    value={found.kind === 'erc20' ? shortAddress(found.erc20Address, 10, 8) : found.denom}
                    mono
                  />
                  <KeyValue label="Lane" value={found.kind === 'erc20' ? 'EVM' : 'Native'} />
                  <KeyValue label="Decimals" value={String(found.decimals)} />
                </View>
              </Card>
            </>
          )}
        </>
      )}
    </PushedScreen>
  );
}

export function ReceiveSheet({ visible, onClose, wallet, token }: any) {
  const { colors } = useTheme();
  const [mode, setMode] = useState('native');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible) {
      setCopied(false);
      setMode('native');
    }
  }, [visible]);

  const address = wallet.accounts[mode].address;
  const label = mode === 'native' ? 'Native' : mode.toUpperCase();

  const copyAddress = async () => {
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
        <View>
          <Eyebrow>Receive</Eyebrow>
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 20, marginTop: 3 }}>
            {token.symbol}
          </Text>
        </View>
        <IconBtn onPress={onClose} size={36}>
          <X color={colors.text} size={18} strokeWidth={2.2} />
        </IconBtn>
      </View>

      <View
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: spacing.radiusSm,
          borderWidth: 1,
          flexDirection: 'row',
          marginBottom: 18,
          padding: 4,
        }}
      >
        {['native', 'evm', 'svm'].map((item) => (
          <Pressable
            key={item}
            onPress={() => setMode(item)}
            style={{
              alignItems: 'center',
              backgroundColor: mode === item ? colors.card : 'transparent',
              borderRadius: spacing.radiusSm - 4,
              flex: 1,
              paddingVertical: 9,
            }}
          >
            <Text
              style={{
                color: mode === item ? colors.text : colors.subtle,
                fontFamily: fonts.mono,
                fontSize: 11,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              {item === 'native' ? 'Native' : item.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ alignItems: 'center' }}>
        <Eyebrow style={{ marginBottom: 14 }}>{`QoreChain ${label} address`}</Eyebrow>
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14 }}>
          <QRCode value={address} size={188} backgroundColor="#FFFFFF" color="#111008" />
        </View>
        <Text
          selectable
          style={{
            color: colors.text,
            fontFamily: fonts.monoRegular,
            fontSize: 12,
            lineHeight: 18,
            marginTop: 16,
            textAlign: 'center',
          }}
        >
          {address}
        </Text>
        <Text
          style={{
            color: colors.subtle,
            fontSize: 12,
            lineHeight: 17,
            marginTop: 10,
            textAlign: 'center',
          }}
        >
          QOR uses one balance across QoreChain address views. Share the format the sender's wallet
          supports.
        </Text>
      </View>

      <View style={{ marginTop: 18 }}>
        <Button label={copied ? 'Copied!' : 'Copy address'} onPress={copyAddress} />
      </View>
    </Sheet>
  );
}

export function ScannerModal({ visible, onClose, onUse }: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState('');

  // Opening the scanner and the OS permission dialog can briefly background the
  // app — suppress the auto-lock so the user isn't kicked to the lock screen.
  useEffect(() => {
    if (visible) suppressAutoLock();
    else setScanned('');
  }, [visible]);

  const askPermission = () => {
    suppressAutoLock();
    requestPermission();
  };

  const handleScan = ({ data }: any) => {
    if (!scanned) setScanned(String(data || '').trim());
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ backgroundColor: colors.bg, flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          <View
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingHorizontal: spacing.screen,
              paddingVertical: 10,
            }}
          >
            <View>
              <Eyebrow>Scanner</Eyebrow>
              <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 18, marginTop: 2 }}>
                Scan QR code
              </Text>
            </View>
            <IconBtn onPress={onClose}>
              <X color={colors.text} size={20} strokeWidth={2.2} />
            </IconBtn>
          </View>
          {!permission?.granted ? (
            <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: spacing.screen }}>
              <Notice text="Camera permission is needed to scan wallet addresses." />
              <Button label="Allow camera" onPress={askPermission} />
            </View>
          ) : (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleScan}
            />
          )}
          {!!scanned && (
            <View
              style={{
                paddingBottom: insets.bottom + 16,
                paddingHorizontal: spacing.screen,
                paddingTop: 14,
              }}
            >
              <Card eyebrow="Scanned address">
                <Text selectable style={{ color: colors.text, fontFamily: fonts.monoRegular, fontSize: 12.5, lineHeight: 19 }}>
                  {scanned}
                </Text>
              </Card>
              <View style={{ gap: 10, marginTop: 12 }}>
                <Button label="Use address" onPress={() => onUse(scanned)} />
                <Button label="Copy result" variant="secondary" onPress={() => Clipboard.setStringAsync(scanned)} />
              </View>
            </View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
