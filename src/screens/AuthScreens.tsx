import * as Haptics from 'expo-haptics';
import { ChevronLeft, Delete, Fingerprint, X } from 'lucide-react-native';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { authenticateBiometrics, setPin, tapHaptic, verifyPin } from '../authService';
import { createWallet, restoreWallet } from '../qoreWallet';
import { useTheme } from '../ThemeContext';
import { fonts, spacing } from '../theme';
import { Button, dismissKeyboardAndWait, Eyebrow, IconBtn, LoadingDots, Notice, Pill, Sheet, SheetTextInput, SlideIn, useFocusGlow } from '../ui';

/** Run `handler` on Android hardware back while this screen is shown. */
function useHardwareBack(handler: () => boolean) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [handler]);
}

const logo = require('../../assets/aegis/aegis_padded.png');
const AnimatedView: any = Animated.View;

export function LandingScreen({ onStart, notice }: any) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.bg, flex: 1 }}>
      <SafeAreaView style={{ flex: 1, paddingHorizontal: spacing.screen }} edges={['top', 'bottom', 'left', 'right']}>
        <View style={{ flex: 1 }} />
        <View style={{ alignItems: 'center' }}>
          <Image source={logo} style={{ height: 148, marginBottom: 24, width: 148 }} />
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 40, letterSpacing: 2 }}>
            AEGIS
            <Text style={{ color: colors.accent }}>-AI</Text>
          </Text>
          <Text
            style={{
              color: colors.muted,
              fontSize: 15,
              lineHeight: 23,
              marginTop: 12,
              maxWidth: 280,
              textAlign: 'center',
            }}
          >
            The agentic, quantum-safe wallet for{' '}
            <Text style={{ color: colors.text, fontWeight: '700' }}>QoreChain</Text>.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 22 }}>
            <Pill label="Triple-VM" />
            <Pill label="Quantum-safe" />
            <Pill label="On-chain AI" />
          </View>
          {!!notice && (
            <View style={{ marginTop: 18, width: '100%' }}>
              <Notice text={notice} />
            </View>
          )}
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ marginBottom: 10 }}>
          <Button label="Get started" onPress={onStart} />
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * "Name your wallet" step, shown right after the user picks create/import.
 * Validates duplicates inline (the sheet stays open on error); Skip proceeds
 * with no name. No autoFocus — focusing during the modal's open animation is
 * what caused ghost focus and unresponsive buttons.
 */
export function WalletNameSheet({ visible, onClose, onSubmit, submitLabel = 'Continue' }: any) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const nameGlow = useFocusGlow();

  useEffect(() => {
    if (visible) {
      setName('');
      setError('');
    }
  }, [visible]);

  const submit = async (value: string) => {
    // Validate first — on error the keyboard stays up so the user can just
    // type a different name.
    if (value) {
      const { getWallets } = await import('../walletStorage');
      const wallets = await getWallets();
      if (wallets.some((item: any) => item.label.toLowerCase() === value.toLowerCase())) {
        setError(`You already have a wallet named “${value}”. Pick a different name.`);
        return;
      }
    }
    // Then wait for the keyboard to fully hide before the sheet unmounts —
    // closing mid-hide is what left the phantom padding behind (the Skip bug).
    await dismissKeyboardAndWait();
    onSubmit(value);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Eyebrow style={{ marginBottom: 6 }}>Name your wallet</Eyebrow>
      <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>
        A label that helps you tell your wallets apart. You can change it anytime.
      </Text>
      <View
        style={[
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.negative : colors.border,
            borderRadius: spacing.radiusSm,
            borderWidth: 1,
            paddingHorizontal: 16,
            paddingVertical: 13,
          },
          !error && nameGlow.style,
        ]}
      >
        <SheetTextInput
          style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 15, padding: 0 }}
          {...nameGlow.inputProps}
          value={name}
          onChangeText={(next) => {
            setName(next);
            setError('');
          }}
          placeholder={'e.g. "Main wallet"'}
          placeholderTextColor={colors.faint}
          maxLength={24}
          onSubmitEditing={() => name.trim() && submit(name.trim())}
          returnKeyType="done"
        />
      </View>
      {!!error && (
        <Text style={{ color: colors.negative, fontSize: 12.5, lineHeight: 18, marginTop: 8 }}>
          {error}
        </Text>
      )}
      <View style={{ gap: 10, marginTop: 14 }}>
        <Button label={submitLabel} onPress={() => submit(name.trim())} disabled={!name.trim()} />
        <Button label="Skip" variant="secondary" onPress={() => submit('')} />
      </View>
    </Sheet>
  );
}

/**
 * The single create/import wallet flow, shared by the onboarding "Set up
 * wallet" screen and the wallet manager's "Add wallet" screen — one place for
 * the option cards, name sheet, phrase input, busy modal, and their fixes.
 *
 * `onComplete(derived, label)` is awaited inside the try/catch, so failures in
 * the host (e.g. duplicate-wallet checks) surface in this panel's error notice.
 * The `handleBack` ref method lets hosts close the phrase panel / swallow back
 * presses while busy before navigating away themselves.
 */
export const WalletSetupPanel = forwardRef(function WalletSetupPanel(
  { onComplete, createSub = 'Fresh keys, generated on this device.', onRestoreInputFocus, onRestoreInputBlur }: any,
  ref: any,
) {
  const { colors } = useTheme();
  const [mnemonic, setMnemonic] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [error, setError] = useState('');
  // Which action the pending name sheet belongs to: 'create' | 'import' | null
  const [nameFor, setNameFor] = useState<'create' | 'import' | null>(null);
  const [label, setLabel] = useState('');

  useImperativeHandle(
    ref,
    () => ({
      /** True when the back press was consumed (busy, or phrase panel closed). */
      handleBack: () => {
        if (busy) return true;
        if (restoreOpen) {
          setRestoreOpen(false);
          return true;
        }
        return false;
      },
    }),
    [busy, restoreOpen],
  );

  const create = async (walletName: string) => {
    setBusy(true);
    setError('');
    // Key derivation blocks the JS thread for several seconds — wait for the
    // name sheet's close animation to finish and the busy modal to paint first.
    await new Promise((resolve) => setTimeout(resolve, 350));
    try {
      await onComplete(await createWallet(), walletName);
    } catch (caught: any) {
      setError(caught?.message || 'Wallet creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const normalized = mnemonic.toLowerCase().trim().replace(/\s+/g, ' ');
    const wordCount = normalized ? normalized.split(' ').length : 0;
    if (wordCount !== 12 && wordCount !== 24) {
      setError(`Please enter exactly 12 or 24 words (found ${wordCount}).`);
      return;
    }
    setBusy(true);
    setError('');
    // Ghost-keyboard fix: the phrase textarea is usually still focused here —
    // wait for the keyboard to fully hide before derivation blocks the JS
    // thread and the screen unmounts mid-hide.
    await dismissKeyboardAndWait();
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await onComplete(await restoreWallet(normalized), label);
    } catch (caught: any) {
      setError(caught?.message || 'Invalid recovery phrase.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!!error && <Notice text={error} tone="error" />}

      <SetupOption
        title="Create a new wallet"
        sub={createSub}
        onPress={busy ? undefined : () => setNameFor('create')}
      />

      <View style={{ height: 12 }} />

      <SetupOption
        title="Import a recovery phrase"
        sub="Restore a wallet from its 12 or 24 words."
        onPress={busy || restoreOpen ? undefined : () => setNameFor('import')}
      >
        {restoreOpen && (
          <View style={{ marginTop: 14 }}>
            <TextInput
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: spacing.radiusSm,
                borderWidth: 1,
                color: colors.text,
                fontFamily: fonts.monoRegular,
                fontSize: 13,
                lineHeight: 20,
                marginBottom: 12,
                minHeight: 112,
                padding: 14,
                textAlignVertical: 'top',
              }}
              value={mnemonic}
              onFocus={onRestoreInputFocus}
              onBlur={onRestoreInputBlur}
              onChangeText={setMnemonic}
              placeholder="Enter 12 or 24 words separated by spaces"
              placeholderTextColor={colors.faint}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button label={busy ? 'Restoring…' : 'Restore wallet'} onPress={restore} disabled={busy} loading={busy} />
          </View>
        )}
      </SetupOption>

      <WalletNameSheet
        visible={Boolean(nameFor)}
        onClose={() => setNameFor(null)}
        submitLabel={nameFor === 'create' ? 'Create wallet' : 'Continue'}
        onSubmit={(walletName: string) => {
          const action = nameFor;
          setNameFor(null);
          setLabel(walletName);
          if (action === 'create') create(walletName);
          else setRestoreOpen(true);
        }}
      />

      <WalletBusyModal
        visible={busy}
        title={restoreOpen ? 'Restoring your wallet' : 'Creating your wallet'}
        sub={
          restoreOpen
            ? 'Restoring your wallet. This will only take a few seconds.'
            : 'Generating your quantum-safe keys on this device. This will only take a few seconds.'
        }
      />
    </>
  );
});

export function OnboardingScreen({ onWallet, notice, onBack }: any) {
  const { colors } = useTheme();
  const panelRef = useRef<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  const restoreInputFocusedRef = useRef(false);
  const [restoreKeyboardInset, setRestoreKeyboardInset] = useState(0);

  // Hardware back: close the restore panel first, otherwise return to landing
  // (never let it fall through and close the app).
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

  useHardwareBack(() => {
    if (panelRef.current?.handleBack()) return true;
    onBack();
    return true;
  });

  return (
    <SlideIn style={{ backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left', 'right']}>
        {/* This screen lives outside the main shell's keyboard handling, so it
            needs its own — keeps the phrase textarea visible on short screens. */}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ flexGrow: 1, padding: spacing.screen, paddingBottom: spacing.screen + 32 + restoreKeyboardInset, paddingTop: 6 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (restoreInputFocusedRef.current && restoreKeyboardInset > 0) {
              scrollRef.current?.scrollToEnd({ animated: true });
            }
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Tap empty space → dismiss keyboard; scrolling cancels the press. */}
          <Pressable onPress={Keyboard.dismiss} accessible={false}>
          <View style={{ alignItems: 'center', flexDirection: 'row', marginBottom: 26 }}>
            <View pointerEvents="none" style={{ alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 18 }}>
                Set up wallet
              </Text>
            </View>
            <View style={{ flex: 1 }} />
            <IconBtn
              onPress={() => {
                // Close the keyboard first if it's up; second tap leaves.
                if ((TextInput as any).State?.currentlyFocusedInput?.()) {
                  Keyboard.dismiss();
                  return;
                }
                onBack();
              }}
            >
              <X color={colors.text} size={20} strokeWidth={2.2} />
            </IconBtn>
          </View>

          {!!notice && <Notice text={notice} />}

          <WalletSetupPanel
            ref={panelRef}
            createSub="Recommended for new users."
            onRestoreInputFocus={() => {
              restoreInputFocusedRef.current = true;
            }}
            onRestoreInputBlur={() => {
              restoreInputFocusedRef.current = false;
            }}
            onComplete={(derived: any, label: string) => onWallet({ ...derived, label })}
          />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </SlideIn>
  );
}

/**
 * Blocking overlay while keys derive. A modal (not inline dots) so the whole
 * screen visibly waits — derivation freezes the JS thread, and inline UI
 * looked stuck; the Reanimated dots keep pulsing on the UI thread.
 */
export function WalletBusyModal({ visible, title, sub }: { visible: boolean; title: string; sub: string }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.overlay,
          flex: 1,
          justifyContent: 'center',
          padding: 32,
        }}
      >
        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: spacing.radius,
            borderWidth: 1,
            maxWidth: 320,
            paddingHorizontal: 26,
            paddingVertical: 30,
            width: '100%',
          }}
        >
          <LoadingDots size={8} />
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.displaySemi,
              fontSize: 16,
              marginTop: 18,
              textAlign: 'center',
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              color: colors.subtle,
              fontSize: 12.5,
              lineHeight: 18,
              marginTop: 6,
              textAlign: 'center',
            }}
          >
            {sub}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

function SetupOption({ title, sub, busy, onPress, children }: any) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.cardPressed : colors.card,
        borderColor: pressed ? colors.accent : colors.border,
        borderRadius: spacing.radius,
        borderWidth: 1,
        padding: spacing.cardPad,
      })}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 16 }}>
            {title}
          </Text>
          <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginTop: 4 }}>{sub}</Text>
        </View>
        {busy && <LoadingDots />}
      </View>
      {children}
    </Pressable>
  );
}

export function PinSetupScreen({ auth, onDone, onBack, notice }: any) {
  const { colors } = useTheme();
  const [pin, setPinValue] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [bioPromptOpen, setBioPromptOpen] = useState(false);
  const confirming = Boolean(firstPin);

  // Back: from the confirm step, return to the first entry; from the first
  // step, return to wallet setup (onBack). Never close the app.
  useHardwareBack(() => {
    if (saving) return true;
    if (confirming) {
      setFirstPin('');
      setPinValue('');
      setError('');
      return true;
    }
    onBack?.();
    return true;
  });

  const finish = async (enableBiometrics: boolean) => {
    setBioPromptOpen(false);
    setSaving(true);
    try {
      await onDone({ enableBiometrics });
    } catch (caught: any) {
      setError(caught?.message || String(caught));
    } finally {
      setSaving(false);
    }
  };

  const addDigit = async (digit: string) => {
    if (pin.length >= 6 || saving) return;
    tapHaptic();
    const next = `${pin}${digit}`;
    setPinValue(next);
    setError('');
    if (next.length !== 6) return;
    if (!confirming) {
      setTimeout(() => {
        setFirstPin(next);
        setPinValue('');
      }, 100);
      return;
    }
    if (next !== firstPin) {
      setTimeout(() => {
        setPinValue('');
        setFirstPin('');
        setError('PIN did not match. Start again.');
      }, 100);
      return;
    }
    setSaving(true);
    try {
      await setPin(next);
      // The enrollment choice belongs on the Agent screen, after the wallet is
      // fully available. Keeping this screen in its saving state also keeps the
      // PIN confirmation visible for the entire wallet-creation operation.
      await onDone({ enableBiometrics: false, promptForBiometrics: Boolean(auth?.biometricsAvailable) });
    } catch (caught: any) {
      setError(caught?.message || String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideIn>
      <PasscodeScaffold
        title={confirming ? 'Confirm passcode' : 'Set passcode'}
        subtitle={confirming ? 'Enter the same 6 digits again' : 'Protect your wallet on this device'}
        pinLength={pin.length}
        error={error || notice}
        footer={saving ? 'Securing wallet' : undefined}
        loading={saving}
        onDigit={addDigit}
        onBackspace={() => setPinValue((value) => value.slice(0, -1))}
        onBack={
          saving
            ? undefined
            : () => {
                if (confirming) {
                  setFirstPin('');
                  setPinValue('');
                  setError('');
                } else {
                  onBack?.();
                }
              }
        }
        disabled={saving}
      />
      <Sheet visible={bioPromptOpen} onClose={() => finish(false)}>
        <View style={{ alignItems: 'center', marginBottom: 18, marginTop: 6 }}>
          <View
            style={{
              alignItems: 'center',
              backgroundColor: colors.accentSoft,
              borderRadius: 34,
              height: 68,
              justifyContent: 'center',
              width: 68,
            }}
          >
            <Fingerprint color={colors.accent} size={34} strokeWidth={1.8} />
          </View>
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 19, marginTop: 14 }}>
            Enable biometric unlock?
          </Text>
          <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' }}>
            Unlock Aegis with your fingerprint or face instead of typing your passcode.
          </Text>
        </View>
        <View style={{ gap: 10 }}>
          <Button label="Enable" onPress={() => finish(true)} />
          <Button label="Not now" variant="secondary" onPress={() => finish(false)} />
        </View>
      </Sheet>
    </SlideIn>
  );
}

export function LockScreen({ auth, onUnlock }: any) {
  const [pin, setPinValue] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('idle');

  const finishUnlock = () => {
    setStatus('success');
    // Hold long enough for the green fill-and-sweep to finish before unlocking.
    setTimeout(onUnlock, 500);
  };

  const failAttempt = (message?: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setStatus('error');
    setTimeout(() => {
      setPinValue('');
      setStatus('idle');
      if (message) setError(message);
    }, 550);
  };

  const tryBiometric = async () => {
    if (!auth.biometricsEnabled || !auth.biometricsAvailable || checking) return;
    setError('');
    setStatus('checking');
    setChecking(true);
    const ok = await authenticateBiometrics();
    setChecking(false);
    if (ok) {
      finishUnlock();
      return;
    }
    setStatus('idle');
  };

  useEffect(() => {
    // Give the activity time to settle after launch/foreground before prompting,
    // otherwise authenticateAsync rejects with "current activity is no longer available".
    const timer = setTimeout(tryBiometric, 450);
    return () => clearTimeout(timer);
  }, []);

  const addDigit = async (digit: string) => {
    if (pin.length >= 6 || checking) return;
    tapHaptic();
    const next = `${pin}${digit}`;
    setPinValue(next);
    setError('');
    if (status !== 'idle') setStatus('idle');
    if (next.length !== 6) return;
    setChecking(true);
    const result = await verifyPin(next);
    setChecking(false);
    if (result.ok) {
      finishUnlock();
      return;
    }
    failAttempt(
      result.lockedUntil
        ? `Too many attempts. Try again at ${new Date(result.lockedUntil).toLocaleTimeString()}.`
        : 'Incorrect passcode.',
    );
  };

  return (
    <PasscodeScaffold
      pinLength={pin.length}
      status={status}
      error={error}
      onDigit={addDigit}
      onBackspace={() => setPinValue((value) => value.slice(0, -1))}
      onBiometric={auth.biometricsEnabled && auth.biometricsAvailable ? tryBiometric : null}
      disabled={checking}
    />
  );
}

export function PasscodeScaffold({
  title,
  subtitle,
  pinLength,
  status = 'idle',
  error,
  footer,
  loading = false,
  onDigit,
  onBackspace,
  onBiometric,
  onBack,
  disabled,
}: any) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Dots stay empty while a biometric check runs; they only fill for typed
  // digits, then sweep green/red on the result.
  const forceFilled = status === 'success' || status === 'error';
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status !== 'error') return;
    shake.setValue(0);
    Animated.sequence(
      [10, -9, 7, -5, 2, 0].map((toValue) =>
        Animated.timing(shake, { toValue, duration: 55, useNativeDriver: true }),
      ),
    ).start();
  }, [shake, status]);

  return (
    <View style={{ backgroundColor: colors.bg, flex: 1 }}>
      <SafeAreaView
        style={{
          alignItems: 'center',
          flex: 1,
          justifyContent: 'center',
          paddingBottom: 16,
          paddingHorizontal: spacing.screen,
        }}
        edges={['top', 'bottom', 'left', 'right']}
      >
        {!!onBack && (
          <View style={{ left: spacing.screen, position: 'absolute', top: insets.top + 8 }}>
            <IconBtn onPress={onBack}>
              <ChevronLeft color={colors.text} size={22} strokeWidth={2.2} />
            </IconBtn>
          </View>
        )}
        <Image source={logo} style={{ height: 64, marginBottom: 22, width: 64 }} />
        {!!title && (
          <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 22, marginBottom: 6 }}>
            {title}
          </Text>
        )}
        {!!subtitle && <Eyebrow style={{ marginBottom: 28 }}>{subtitle}</Eyebrow>}
        <AnimatedView
          style={{ flexDirection: 'row', gap: 14, marginBottom: 18, transform: [{ translateX: shake }] }}
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <PinDot
              key={index}
              filled={forceFilled || index < pinLength}
              success={status === 'success'}
              failure={status === 'error'}
              index={index}
              loading={loading}
            />
          ))}
        </AnimatedView>
        {!!error && (
          <Text style={{ color: colors.negative, fontSize: 13, fontWeight: '600', marginBottom: 10, textAlign: 'center' }}>
            {error}
          </Text>
        )}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'center',
            marginTop: 10,
            maxWidth: 276,
          }}
        >
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <NumberKey key={digit} digit={digit} disabled={disabled} onPress={onDigit} />
          ))}
          <ActionKey disabled={!onBiometric} onPress={onBiometric}>
            {onBiometric ? <Fingerprint color={colors.accent} size={26} strokeWidth={2} /> : null}
          </ActionKey>
          <NumberKey digit="0" disabled={disabled} onPress={onDigit} />
          <ActionKey disabled={disabled} onPress={onBackspace}>
            <Delete color={colors.muted} size={24} strokeWidth={2} />
          </ActionKey>
        </View>
        {!!footer && (
          <Text
            style={{
              color: colors.subtle,
              fontSize: 12.5,
              lineHeight: 18,
              marginTop: 26,
              textAlign: 'center',
            }}
          >
            {footer}
          </Text>
        )}
      </SafeAreaView>
    </View>
  );
}

const PIN_RING = 22;
const PIN_INNER = 9;
// The theme's `positive` is a pale sage that reads as washed-out here; a crisp
// success green is clearer against the near-black keypad.
const PIN_SUCCESS = '#34C759';

// An outlined ring with an inner dot that fills in. Progress: 0 empty, 1 filled,
// 2 success (green), 3 failure (red).
function PinDot({ filled, success, failure, index = 0, loading = false }: any) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(filled ? 1 : 0)).current;
  const loadingPulse = useSharedValue(0);
  // Whether the ring was already filled BEFORE this settle. A biometric unlock
  // arrives empty → play fill-then-green; a typed PIN is already filled → go
  // straight to green. Either way the colour lands within the unlock delay.
  const wasFilled = useRef(filled);
  useEffect(() => {
    const settled = success || failure;
    const target = failure ? 3 : success ? 2 : filled ? 1 : 0;
    if (settled && !wasFilled.current) {
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 130, useNativeDriver: false }),
        Animated.timing(progress, { toValue: target, duration: 190, delay: index * 26, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.timing(progress, {
        toValue: target,
        duration: settled ? 200 : 130,
        // Stagger so the result reads as a left-to-right wave.
        delay: settled ? index * 26 : 0,
        useNativeDriver: false,
      }).start();
    }
    wasFilled.current = filled;
  }, [failure, filled, index, progress, success]);

  useEffect(() => {
    if (!loading) {
      loadingPulse.value = 0;
      return;
    }

    // This must run on the UI thread: completing setup can briefly occupy JS
    // while keys and wallet storage are finalized.
    loadingPulse.value = withRepeat(
      withSequence(
        withDelay(index * 65, withTiming(1, { duration: 90 })),
        withTiming(0, { duration: 90 }),
        withDelay((5 - index) * 65 + 90, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
  }, [index, loading, loadingPulse]);

  const borderColor = progress.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: [colors.faint, colors.text, PIN_SUCCESS, colors.negative],
  });
  const dotColor = progress.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: [colors.text, colors.text, PIN_SUCCESS, colors.negative],
  });
  // Inner dot grows in as the ring fills (nothing shown while empty).
  const dotScale = progress.interpolate({ inputRange: [0, 0.5, 1, 2, 3], outputRange: [0, 0, 1, 1, 1] });
  const dotOpacity = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1], extrapolate: 'clamp' });
  const ringScale = progress.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [1, 1, 1.12, 1.06] });
  const loadingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + loadingPulse.value * 0.55 }],
  }));

  return (
    <Reanimated.View style={loadingStyle}>
      <AnimatedView
        style={{
          alignItems: 'center',
          borderColor,
          borderRadius: PIN_RING / 2,
          borderWidth: 1.5,
          height: PIN_RING,
          justifyContent: 'center',
          transform: [{ scale: ringScale }],
          width: PIN_RING,
        }}
      >
        <AnimatedView
          style={{
            backgroundColor: dotColor,
            borderRadius: PIN_INNER / 2,
            height: PIN_INNER,
            opacity: dotOpacity,
            transform: [{ scale: dotScale }],
            width: PIN_INNER,
          }}
        />
      </AnimatedView>
    </Reanimated.View>
  );
}

function NumberKey({ digit, disabled, onPress }: any) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => onPress(digit)}
      disabled={disabled}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: pressed ? colors.cardPressed : colors.card,
        borderColor: colors.border,
        borderRadius: 38,
        borderWidth: 1,
        height: 76,
        justifyContent: 'center',
        width: 76,
      })}
    >
      <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 26 }}>{digit}</Text>
    </Pressable>
  );
}

function ActionKey({ children, disabled, onPress }: any) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        alignItems: 'center',
        height: 76,
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
        width: 76,
      })}
    >
      {children}
    </Pressable>
  );
}

export function AuthGateModal({ visible, auth, onClose, onAuthenticated }: any) {
  const [pin, setPinValue] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!visible) {
      setPinValue('');
      setError('');
      setChecking(false);
      setStatus('idle');
      return;
    }
    if (!auth?.hasPin) {
      setTimeout(onAuthenticated, 0);
      return;
    }
    // Auto-prompt biometrics on open (same as the lock screen) so the user
    // doesn't have to tap the fingerprint icon to trigger it.
    if (auth?.biometricsEnabled && auth?.biometricsAvailable) {
      const timer = setTimeout(tryBiometric, 350);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const complete = () => {
    setStatus('success');
    // Hold long enough for the green fill-and-sweep to finish before closing.
    setTimeout(onAuthenticated, 500);
  };

  const tryBiometric = async () => {
    if (!auth.biometricsEnabled || !auth.biometricsAvailable || checking) return;
    setStatus('checking');
    setChecking(true);
    const ok = await authenticateBiometrics();
    setChecking(false);
    if (ok) complete();
    else setStatus('idle');
  };

  const addDigit = async (digit: string) => {
    if (pin.length >= 6 || checking) return;
    tapHaptic();
    const next = `${pin}${digit}`;
    setPinValue(next);
    setError('');
    if (next.length !== 6) return;
    setChecking(true);
    const result = await verifyPin(next);
    setChecking(false);
    if (result.ok) {
      complete();
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setStatus('error');
    setTimeout(() => {
      setPinValue('');
      setStatus('idle');
      setError(
        result.lockedUntil
          ? `Too many attempts. Try again at ${new Date(result.lockedUntil).toLocaleTimeString()}.`
          : 'Incorrect passcode.',
      );
    }, 550);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <PasscodeScaffold
        title="Authorize"
        subtitle="Unlock to continue"
        pinLength={pin.length}
        status={status}
        error={error}
        onDigit={addDigit}
        onBackspace={() => setPinValue((value: string) => value.slice(0, -1))}
        onBiometric={auth.biometricsEnabled && auth.biometricsAvailable ? tryBiometric : null}
        disabled={checking}
      />
    </Modal>
  );
}
