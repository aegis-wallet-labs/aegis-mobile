import * as Clipboard from 'expo-clipboard';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Fingerprint, KeyRound } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { setBiometricsEnabled } from '../authService';
import { languages, useI18n } from '../i18n';
import { getNetworkConfig, qoreNetworks, shortAddress } from '../qoreWallet';
import { useTheme } from '../ThemeContext';
import { fonts, spacing, ThemeMode } from '../theme';
import {
  Button,
  Card,
  Eyebrow,
  IconBtn,
  KeyValue,
  ListRow,
  LoadingDots,
  Screen,
  SectionHeader,
  Sheet,
  Toggle,
} from '../ui';
import { AuthGateModal } from './AuthScreens';

export function SettingsScreen({ wallet, auth, selectedNetwork, onNetworkChanged, onWipe, onAuthChanged, onBack }: any) {
  const { colors, mode, setMode } = useTheme();
  const { t, lang, setLang } = useI18n();
  const activeNetwork = getNetworkConfig(selectedNetwork);
  const [showPhrase, setShowPhrase] = useState(false);
  const [recoveryAuthOpen, setRecoveryAuthOpen] = useState(false);
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  const [wipeAuthOpen, setWipeAuthOpen] = useState(false);
  const [wipeStatus, setWipeStatus] = useState<'idle' | 'deleting' | 'success' | 'error'>('idle');
  const [wipeError, setWipeError] = useState('');
  const [bioBusy, setBioBusy] = useState(false);
  const [copiedLane, setCopiedLane] = useState('');

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showPhrase) { setShowPhrase(false); return true; }
      if (recoveryAuthOpen) { setRecoveryAuthOpen(false); return true; }
      if (wipeAuthOpen) { setWipeAuthOpen(false); return true; }
      if (wipeConfirmOpen) { setWipeConfirmOpen(false); return true; }
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack, recoveryAuthOpen, showPhrase, wipeAuthOpen, wipeConfirmOpen]);

  const copyLane = async (lane: string) => {
    await Clipboard.setStringAsync(wallet.accounts[lane].address);
    setCopiedLane(lane);
    setTimeout(() => setCopiedLane(''), 3000);
  };

  const toggleBio = async () => {
    setBioBusy(true);
    await setBiometricsEnabled(!auth.biometricsEnabled);
    await onAuthChanged();
    setBioBusy(false);
  };

  const deleteActiveWallet = async () => {
    setWipeAuthOpen(false);
    setWipeStatus('deleting');
    setWipeError('');
    try {
      await onWipe();
      setWipeStatus('success');
    } catch (caught: any) {
      setWipeError(caught?.message || 'Could not delete the wallet.');
      setWipeStatus('error');
    }
  };

  const finishDeleteFlow = () => {
    setWipeStatus('idle');
    setWipeError('');
    onBack();
  };

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          paddingHorizontal: spacing.screen,
          paddingVertical: 10,
        }}
      >
        <View
          pointerEvents="none"
          style={{ alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 }}
        >
          <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 18 }}>
            {t('Settings')}
          </Text>
        </View>
        <IconBtn onPress={onBack}>
          <ChevronLeft color={colors.text} size={22} strokeWidth={2.2} />
        </IconBtn>
      </View>

      <Screen>
        <SectionHeader title={t('Appearance')} />
        <Card pad={false}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: spacing.radiusSm,
              flexDirection: 'row',
              margin: 10,
              padding: 4,
            }}
          >
            {(['system', 'light', 'dark'] as ThemeMode[]).map((item) => (
              <Pressable
                key={item}
                onPress={() => setMode(item)}
                style={{
                  alignItems: 'center',
                  backgroundColor: mode === item ? colors.card : 'transparent',
                  borderColor: mode === item ? colors.border : 'transparent',
                  borderRadius: spacing.radiusSm - 4,
                  borderWidth: 1,
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
                  {t(item === 'system' ? 'System' : item === 'light' ? 'Light' : 'Dark')}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <CollapsibleSection
          title={t('Language')}
          summary={languages.find((entry) => entry.code === lang)?.native}
        >
          <Card pad={false}>
            {languages.map((entry, index) => (
              <ListRow
                key={entry.code}
                first={index === 0}
                title={entry.native}
                sub={entry.english}
                trailing={<Toggle active={lang === entry.code} />}
                onPress={() => setLang(entry.code)}
              />
            ))}
          </Card>
        </CollapsibleSection>

        <SectionHeader title={t('Network')} />
        <Card pad={false}>
          {Object.values(qoreNetworks).map((network: any, index: number) => {
            const active = network.key === selectedNetwork;
            return (
              <ListRow
                key={network.key}
                first={index === 0}
                title={network.preset === 'mainnet' ? 'Mainnet' : 'Testnet'}
                sub={network.name}
                trailing={<Toggle active={active} />}
                onPress={() => onNetworkChanged(network.key)}
              />
            );
          })}
        </Card>

        <CollapsibleSection title={t('Network details')}>
          <Card pad={false}>
            <View style={{ paddingHorizontal: spacing.cardPad }}>
              <KeyValue first label="Chain ID" value={activeNetwork.chainId} mono />
              <KeyValue label="EVM chain" value={`${activeNetwork.evmChainId} (${activeNetwork.evmChainHex})`} mono />
              <KeyValue label="Token" value={activeNetwork.token} />
              <KeyValue label="Decimals" value={String(activeNetwork.decimals)} />
              <KeyValue label="Address prefix" value={activeNetwork.addressPrefix} mono />
              <KeyValue label="Coin type" value={String(activeNetwork.coinType)} />
              <KeyValue label="Min gas" value={activeNetwork.minGasPrice} mono />
            </View>
          </Card>
        </CollapsibleSection>

        <CollapsibleSection title={t('Endpoints')}>
          <Card pad={false}>
            <View style={{ paddingHorizontal: spacing.cardPad }}>
              <KeyValue first label="Consensus RPC" value={activeNetwork.endpoints.rpc} mono />
              <KeyValue label="REST / LCD" value={activeNetwork.endpoints.rest} mono />
              <KeyValue label="EVM JSON-RPC" value={activeNetwork.endpoints.evmRpc} mono />
              <KeyValue label="SVM JSON-RPC" value={activeNetwork.endpoints.svmRpc} mono />
              <KeyValue label="WebSocket" value={activeNetwork.endpoints.websocket} mono />
              <KeyValue label="EVM WebSocket" value={activeNetwork.endpoints.evmWs || 'Not available yet'} mono />
            </View>
          </Card>
        </CollapsibleSection>

        <SectionHeader title={t('Security')} />
        <Card pad={false}>
          <ListRow
            first
            leading={<Fingerprint color={colors.accent} size={19} strokeWidth={2} />}
            title={t('Biometric unlock')}
            sub={
              auth.biometricsAvailable
                ? auth.biometricsEnabled
                  ? t('Enabled')
                  : t('Available')
                : t('No biometric hardware detected')
            }
            trailing={<Toggle active={auth.biometricsEnabled} />}
            onPress={auth.biometricsAvailable && !bioBusy ? toggleBio : undefined}
          />
          <ListRow
            leading={<KeyRound color={colors.accent} size={19} strokeWidth={2} />}
            title={t('Recovery phrase')}
            sub={t('Reveal after authentication')}
            trailing={<ChevronRight color={colors.subtle} size={17} strokeWidth={2.2} />}
            onPress={() => setRecoveryAuthOpen(true)}
          />
        </Card>

        <SectionHeader title={t('Addresses')} />
        <Card pad={false}>
          <View style={{ paddingHorizontal: spacing.cardPad }}>
            {(['native', 'evm', 'svm'] as const).map((lane, index) => (
              <KeyValue
                key={lane}
                first={index === 0}
                label={lane === 'native' ? 'Native' : lane.toUpperCase()}
                value={
                  copiedLane === lane ? (
                    <Text style={{ color: colors.positive, fontSize: 13, fontWeight: '600' }}>
                      {t('Copied!')}
                    </Text>
                  ) : (
                    shortAddress(wallet.accounts[lane].address, 10, 8)
                  )
                }
                mono
                onPress={() => copyLane(lane)}
              />
            ))}
          </View>
        </Card>

        <View style={{ marginTop: 26 }}>
          <Button label={t('Delete wallet')} variant="danger" onPress={() => setWipeConfirmOpen(true)} />
        </View>
      </Screen>

      <AuthGateModal
        visible={recoveryAuthOpen}
        auth={auth}
        onClose={() => setRecoveryAuthOpen(false)}
        onAuthenticated={() => {
          setRecoveryAuthOpen(false);
          setShowPhrase(true);
        }}
      />
      <RecoveryPhraseSheet visible={showPhrase} phrase={wallet.mnemonic} onClose={() => setShowPhrase(false)} />

      <Sheet visible={wipeConfirmOpen} onClose={() => setWipeConfirmOpen(false)}>
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <AlertTriangle color={colors.negative} size={28} strokeWidth={2} />
          <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 17, marginTop: 10 }}>
            {wallet.label ? `${t('Delete wallet')}: “${wallet.label}”?` : t('Delete this wallet?')}
          </Text>
          <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' }}>
            {t('Only the currently selected wallet is removed — other wallets on this device stay untouched. Without its recovery phrase, this wallet cannot be restored.')}
          </Text>
        </View>
        <View style={{ gap: 10 }}>
          <Button
            label={t('Delete wallet')}
            variant="danger"
            onPress={() => {
              setWipeConfirmOpen(false);
              setWipeAuthOpen(true);
            }}
          />
          <Button label={t('Cancel')} variant="secondary" onPress={() => setWipeConfirmOpen(false)} />
        </View>
      </Sheet>

      <AuthGateModal
        visible={wipeAuthOpen}
        auth={auth}
        onClose={() => setWipeAuthOpen(false)}
        onAuthenticated={deleteActiveWallet}
      />

      <Sheet
        visible={wipeStatus !== 'idle'}
        onClose={() => {
          if (wipeStatus === 'error') setWipeStatus('idle');
        }}
      >
        <View style={{ alignItems: 'center', marginBottom: 16, marginTop: 4 }}>
          {wipeStatus === 'deleting' ? (
            <View style={{ paddingVertical: 10 }}>
              <LoadingDots size={8} />
            </View>
          ) : wipeStatus === 'success' ? (
            <CheckCircle2 color={colors.positive} size={44} strokeWidth={1.8} />
          ) : (
            <AlertTriangle color={colors.negative} size={36} strokeWidth={2} />
          )}
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 19, marginTop: 12 }}>
            {wipeStatus === 'deleting' ? t('Deleting wallet') : wipeStatus === 'success' ? t('Wallet deleted') : t('Delete failed')}
          </Text>
          {wipeStatus !== 'success' && (
            <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' }}>
              {wipeStatus === 'deleting'
                ? t('Please wait while your wallet is being deleted.')
                : wipeError || t('Could not delete the wallet.')}
            </Text>
          )}
        </View>
        {wipeStatus === 'success' ? (
          <Button label={t('Done')} onPress={finishDeleteFlow} />
        ) : wipeStatus === 'error' ? (
          <Button label={t('Close')} variant="secondary" onPress={() => setWipeStatus('idle')} />
        ) : null}
      </Sheet>
    </View>
  );
}

function CollapsibleSection({ title, summary, children }: { title: string; summary?: string; children: any }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        hitSlop={8}
        style={({ pressed }) => [
          {
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 10,
            marginTop: 26,
            paddingHorizontal: 2,
          },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Eyebrow>{title}</Eyebrow>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
          {!open && !!summary && (
            <Text style={{ color: colors.subtle, fontSize: 12 }}>{summary}</Text>
          )}
          {open ? (
            <ChevronDown color={colors.subtle} size={16} strokeWidth={2.2} />
          ) : (
            <ChevronRight color={colors.subtle} size={16} strokeWidth={2.2} />
          )}
        </View>
      </Pressable>
      {open && children}
    </>
  );
}

function RecoveryPhraseSheet({ visible, phrase, onClose }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible) setCopied(false);
  }, [visible]);

  const copy = async () => {
    await Clipboard.setStringAsync(phrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Eyebrow style={{ marginBottom: 6 }}>{t('Recovery phrase')}</Eyebrow>
      <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
        {t('Store these words offline. Anyone with them can control this wallet.')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {String(phrase || '')
          .split(' ')
          .map((word: string, index: number) => (
            <View
              key={`${word}-${index}`}
              style={{
                alignItems: 'center',
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: 999,
                borderWidth: 1,
                flexDirection: 'row',
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 8,
              }}
            >
              <Text style={{ color: colors.faint, fontFamily: fonts.mono, fontSize: 10 }}>
                {index + 1}
              </Text>
              <Text selectable style={{ color: colors.text, fontFamily: fonts.monoRegular, fontSize: 13 }}>
                {word}
              </Text>
            </View>
          ))}
      </View>
      <View style={{ gap: 10 }}>
        <Button label={copied ? t('Copied!') : t('Copy phrase')} onPress={copy} />
        <Button label={t('Close')} variant="secondary" onPress={onClose} />
      </View>
    </Sheet>
  );
}
