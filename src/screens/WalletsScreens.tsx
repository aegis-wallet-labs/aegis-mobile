import { AlertTriangle, CheckCircle2, MoreHorizontal, Plus } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, TextInput, View } from 'react-native';
import { useNav } from '../nav';
import { shortAddress } from '../qoreWallet';
import { useTheme } from '../ThemeContext';
import { fonts, spacing } from '../theme';
import {
  Button,
  Card,
  dismissKeyboardAndWait,
  Eyebrow,
  IconBtn,
  KeyValue,
  ListRow,
  LoadingDots,
  Notice,
  Pill,
  PushedScreen,
  Sheet,
  SheetTextInput,
} from '../ui';
import { AuthGateModal, WalletSetupPanel } from './AuthScreens';
import { getActiveWalletId, getWallets, MAX_WALLETS } from '../walletStorage';

function WalletAvatar({ label }: { label: string }) {
  const { colors } = useTheme();
  const initials = String(label || 'W')
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: colors.accentSoft,
        borderRadius: 12,
        height: 40,
        justifyContent: 'center',
        width: 40,
      }}
    >
      <Text style={{ color: colors.accent, fontFamily: fonts.displaySemi, fontSize: 14 }}>
        {initials}
      </Text>
    </View>
  );
}

/**
 * Wallet manager: list, switch, rename, delete, and add (up to MAX_WALLETS).
 * All wallets share the app passcode; each is otherwise fully separate.
 */
export function WalletManagerScreen({ walletOps, auth, selectedNetwork, onGoHome }: any) {
  const { colors } = useTheme();
  const nav = useNav();
  const [wallets, setWallets] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<any>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteAuthOpen, setDeleteAuthOpen] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'deleting' | 'success' | 'error'>('idle');
  const [deleteError, setDeleteError] = useState('');
  const [deleteReturnHome, setDeleteReturnHome] = useState(false);
  const [error, setError] = useState('');

  const reload = async () => {
    const [list, active] = await Promise.all([getWallets(), getActiveWalletId()]);
    setWallets(list);
    setActiveId(active);
  };

  useEffect(() => {
    reload();
  }, []);

  const switchTo = async (entry: any) => {
    if (entry.id === activeId || switchingId) return;
    setSwitchingId(entry.id);
    setError('');
    try {
      await walletOps.switch(entry.id);
      // Land on the home screen with the new wallet active.
      onGoHome?.();
    } catch (caught: any) {
      setError(caught?.message || 'Could not switch wallets.');
      setSwitchingId(null);
    }
  };

  const rename = async () => {
    if (!menuFor) return;
    setRenameError('');
    try {
      await walletOps.rename(menuFor.id, renameValue);
      await dismissKeyboardAndWait();
      setRenameOpen(false);
      setMenuFor(null);
      await reload();
    } catch (caught: any) {
      // Keep the sheet open so the user can just type a different name.
      setRenameError(caught?.message || 'Could not rename the wallet.');
    }
  };

  const deleteWallet = async () => {
    if (!menuFor) return;
    const deletedActive = menuFor.id === activeId;
    setDeleteAuthOpen(false);
    setDeleteStatus('deleting');
    setDeleteError('');
    setDeleteReturnHome(deletedActive);
    setError('');
    try {
      await walletOps.remove(menuFor.id);
      setMenuFor(null);
      if (!deletedActive) await reload();
      setDeleteStatus('success');
    } catch (caught: any) {
      setDeleteError(caught?.message || 'Could not delete the wallet.');
      setDeleteStatus('error');
    }
  };

  const finishDeleteFlow = () => {
    setDeleteStatus('idle');
    setDeleteError('');
    if (deleteReturnHome) onGoHome?.();
  };

  return (
    <PushedScreen
      title="Wallets"
      onBack={nav.pop}
      right={
        wallets.length < MAX_WALLETS ? (
          <IconBtn
            onPress={() =>
              nav.push(
                <AddWalletScreen
                  walletOps={walletOps}
                  onDone={() => {
                    // New wallet is active — land on the home screen for it.
                    if (onGoHome) onGoHome();
                    else nav.pop();
                  }}
                />,
              )
            }
          >
            <Plus color={colors.text} size={20} strokeWidth={2.2} />
          </IconBtn>
        ) : undefined
      }
    >
      {!!error && <Notice text={error} tone="error" />}

      <Card pad={false}>
        {wallets.map((entry, index) => {
          const active = entry.id === activeId;
          return (
            <ListRow
              key={entry.id}
              first={index === 0}
              leading={<WalletAvatar label={entry.label} />}
              title={entry.label}
              titleRight={active ? <Pill label="Active" tone="accent" /> : undefined}
              sub={entry.addressPreview ? shortAddress(entry.addressPreview, 10, 6) : active ? 'This wallet is in use' : 'Tap to switch'}
              trailing={
                switchingId === entry.id ? (
                  <LoadingDots />
                ) : (
                  <IconBtn
                    size={34}
                    onPress={() => {
                      setMenuFor(entry);
                      setRenameValue(entry.label);
                    }}
                  >
                    <MoreHorizontal color={colors.subtle} size={17} strokeWidth={2.2} />
                  </IconBtn>
                )
              }
              onPress={() => switchTo(entry)}
            />
          );
        })}
      </Card>

      {/* Per-wallet actions */}
      <Sheet visible={Boolean(menuFor) && !renameOpen && !deleteOpen} onClose={() => setMenuFor(null)}>
        {!!menuFor && (
          <>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <WalletAvatar label={menuFor.label} />
              <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 17, marginTop: 10 }}>
                {menuFor.label}
              </Text>
            </View>
            <View style={{ gap: 10 }}>
              {menuFor.id !== activeId && (
                <Button
                  label="Switch to this wallet"
                  onPress={() => {
                    const entry = menuFor;
                    setMenuFor(null);
                    switchTo(entry);
                  }}
                />
              )}
              <Button label="Rename" variant="secondary" onPress={() => setRenameOpen(true)} />
              <Button label="Delete wallet" variant="danger" onPress={() => setDeleteOpen(true)} />
              <Button label="Cancel" variant="secondary" onPress={() => setMenuFor(null)} />
            </View>
          </>
        )}
      </Sheet>

      {/* Rename */}
      <Sheet
        visible={renameOpen}
        onClose={() => {
          setRenameOpen(false);
          setRenameError('');
        }}
      >
        <Eyebrow style={{ marginBottom: 10 }}>Rename wallet</Eyebrow>
        <Card>
          <SheetTextInput
            style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 15, padding: 0 }}
            value={renameValue}
            onChangeText={(next) => {
              setRenameValue(next);
              setRenameError('');
            }}
            placeholder="Wallet name"
            placeholderTextColor={colors.faint}
            maxLength={24}
            onSubmitEditing={rename}
            returnKeyType="done"
          />
        </Card>
        {!!renameError && (
          <Text style={{ color: colors.negative, fontSize: 12.5, lineHeight: 18, marginTop: 8 }}>
            {renameError}
          </Text>
        )}
        <View style={{ gap: 10, marginTop: 14 }}>
          <Button label="Save" onPress={rename} disabled={!renameValue.trim()} />
          <Button
            label="Cancel"
            variant="secondary"
            onPress={() => {
              setRenameOpen(false);
              setRenameError('');
            }}
          />
        </View>
      </Sheet>

      {/* Delete: warning → passcode gate */}
      <Sheet visible={deleteOpen} onClose={() => setDeleteOpen(false)}>
        {!!menuFor && (
          <>
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 17 }}>
                Delete “{menuFor.label}”?
              </Text>
              <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginTop: 8, textAlign: 'center' }}>
                Only this wallet is removed — your other wallets stay untouched. Without its
                recovery phrase, this wallet cannot be restored.
                {wallets.length === 1
                  ? '\n\nThis is your last wallet: deleting it also removes your passcode and returns you to setup.'
                  : ''}
              </Text>
            </View>
            <View style={{ gap: 10 }}>
              <Button
                label="Delete wallet"
                variant="danger"
                onPress={() => {
                  setDeleteOpen(false);
                  setDeleteAuthOpen(true);
                }}
              />
              <Button label="Cancel" variant="secondary" onPress={() => setDeleteOpen(false)} />
            </View>
          </>
        )}
      </Sheet>

      <AuthGateModal
        visible={deleteAuthOpen}
        auth={auth}
        onClose={() => setDeleteAuthOpen(false)}
        onAuthenticated={deleteWallet}
      />

      <Sheet
        visible={deleteStatus !== 'idle'}
        onClose={() => {
          if (deleteStatus === 'error') setDeleteStatus('idle');
        }}
      >
        <View style={{ alignItems: 'center', marginBottom: 16, marginTop: 4 }}>
          {deleteStatus === 'deleting' ? (
            <View style={{ paddingVertical: 10 }}>
              <LoadingDots size={8} />
            </View>
          ) : deleteStatus === 'success' ? (
            <CheckCircle2 color={colors.positive} size={44} strokeWidth={1.8} />
          ) : (
            <AlertTriangle color={colors.negative} size={36} strokeWidth={2} />
          )}
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 19, marginTop: 12 }}>
            {deleteStatus === 'deleting' ? 'Deleting wallet' : deleteStatus === 'success' ? 'Wallet deleted' : 'Delete failed'}
          </Text>
          {deleteStatus !== 'success' && (
            <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' }}>
              {deleteStatus === 'deleting'
                ? 'Please wait while your wallet is being deleted.'
                : deleteError || 'Could not delete the wallet.'}
            </Text>
          )}
        </View>
        {deleteStatus === 'success' ? (
          <Button label="Done" onPress={finishDeleteFlow} />
        ) : deleteStatus === 'error' ? (
          <Button label="Close" variant="secondary" onPress={() => setDeleteStatus('idle')} />
        ) : null}
      </Sheet>
    </PushedScreen>
  );
}

export function AddWalletScreen({ walletOps, onDone }: any) {
  const { colors } = useTheme();
  const nav = useNav();
  const panelRef = useRef<any>(null);
  const setupScrollRef = useRef<ScrollView>(null);
  const restoreInputFocusedRef = useRef(false);
  const [restoreKeyboardInset, setRestoreKeyboardInset] = useState(0);
  const [added, setAdded] = useState<any>(null);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      if (!restoreInputFocusedRef.current) return;
      setRestoreKeyboardInset(event.endCoordinates.height + 24);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setRestoreKeyboardInset(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const done = async () => {
    await dismissKeyboardAndWait();
    onDone();
  };

  if (added) {
    return (
      <PushedScreen title="Wallet added" onBack={done} footer={<Button label="Done" onPress={done} />}>
        <View style={{ alignItems: 'center', marginTop: 28 }}>
          <CheckCircle2 color={colors.positive} size={52} strokeWidth={1.6} />
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 20, marginTop: 14 }}>
            {added.label} is ready
          </Text>
        </View>
        <View style={{ marginTop: 24 }}>
          <Card pad={false}>
            <View style={{ paddingHorizontal: spacing.cardPad }}>
              <KeyValue first label="Address" value={shortAddress(added.address, 12, 10)} mono />
            </View>
          </Card>
        </View>
      </PushedScreen>
    );
  }

  return (
    <PushedScreen
      title="Add wallet"
      scroll={false}
      onBack={() => {
        if (panelRef.current?.handleBack()) return;
        nav.pop();
      }}
    >
      <ScrollView
        ref={setupScrollRef}
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: 24 + restoreKeyboardInset,
          paddingHorizontal: spacing.screen,
          paddingTop: 8,
        }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (restoreInputFocusedRef.current && restoreKeyboardInset > 0) {
            setupScrollRef.current?.scrollToEnd({ animated: true });
          }
        }}
        showsVerticalScrollIndicator={false}
      >
        <WalletSetupPanel
          ref={panelRef}
          onRestoreInputFocus={() => {
            restoreInputFocusedRef.current = true;
          }}
          onRestoreInputBlur={() => {
            restoreInputFocusedRef.current = false;
          }}
          onComplete={async (derived: any, label: string) => {
            const entry = await walletOps.addAndSelect({
              label: String(label || '').trim(),
              mnemonic: derived.mnemonic,
              derived,
            });
            setAdded({ label: entry.label, address: derived.accounts.native.address });
          }}
        />
      </ScrollView>
    </PushedScreen>
  );
}
