import './src/randomValues';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import { Sora_500Medium, Sora_600SemiBold, Sora_700Bold, useFonts } from '@expo-google-fonts/sora';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeftRight, BookUser, Bot, ChevronDown, ChevronRight, Fingerprint, Globe, History, MessageSquare, Plug, Settings, Wallet, WalletCards, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Image, InteractionManager, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StatusBar as RNStatusBar, Text, View } from 'react-native';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { clearAuth, getAuthState, setBiometricsEnabled } from './src/authService';
import { isAutoLockSuppressed } from './src/authLock';
import { NavProvider } from './src/nav';
import { fetchConversations, fetchCredits } from './src/chatService';
import { getCachedSync } from './src/dataCache';
import { APP_VERSION, isUpdateRequired, useRemoteConfig } from './src/remoteConfig';
import { I18nProvider, useI18n } from './src/i18n';
import { restoreWallet, warmAuthAccount } from './src/qoreWallet';
import {
  LandingScreen,
  LockScreen,
  OnboardingScreen,
  PinSetupScreen,
} from './src/screens/AuthScreens';
import { AssetsScreen } from './src/screens/AssetsScreens';
import { BrowserScreen } from './src/screens/BrowserScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SwapScreen } from './src/screens/SwapScreen';
import { fonts, spacing } from './src/theme';
import { ThemeProvider, useTheme } from './src/ThemeContext';
import { Button, dismissKeyboardAndWait, IconBtn, TAB_BAR_HEIGHT } from './src/ui';
import {
  addWallet,
  getActiveWalletId,
  getStoredNetwork,
  getWallets,
  removeWallet,
  renameWallet,
  saveNetwork,
  setActiveWalletId,
} from './src/walletStorage';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * "Open in AEGIS" deeplinks: aegisai://browse?url=https://dapp.example
 * (also accepts the hosts `open` and `dapp`). Returns the target URL or null.
 * Parsed manually — Hermes' URL implementation lacks searchParams.
 */
function parseDappDeeplink(raw: string | null) {
  if (!raw || !/^aegisai:\/\/(browse|open|dapp)\b/i.test(raw)) return null;
  const match = raw.match(/[?&]url=([^&]+)/);
  if (!match) return null;
  try {
    const target = decodeURIComponent(match[1]);
    return /^https?:\/\//i.test(target) ? target : null;
  } catch {
    return null;
  }
}

const bottomTabs = [
  { key: 'Agent', label: 'Agent', Icon: Bot },
  { key: 'Wallet', label: 'Assets', Icon: Wallet },
  { key: 'Swap', label: 'Swap', Icon: ArrowLeftRight },
  { key: 'Browser', label: 'Browser', Icon: Globe },
];

export default function App() {
  const [fontsLoaded] = useFonts({
    Sora_500Medium,
    Sora_600SemiBold,
    Sora_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  return (
    // initialMetrics: without it the first frame renders with inset 0 (content
    // pushed into the status bar) until the native measurement arrives.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <BottomSheetModalProvider>
            <I18nProvider>
              <Root fontsLoaded={fontsLoaded} />
            </I18nProvider>
          </BottomSheetModalProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { colors, isDark } = useTheme();
  const [introDone, setIntroDone] = useState(false);
  const nativeSplashHidden = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setIntroDone(true), 850);
    return () => clearTimeout(timer);
  }, []);

  const hideNativeSplash = useCallback(() => {
    if (nativeSplashHidden.current) return;
    nativeSplashHidden.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <View onLayout={hideNativeSplash} style={{ backgroundColor: colors.bg, flex: 1 }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {!fontsLoaded ? (
        <IntroSplash />
      ) : (
        <UpdateGate>
          <AegisApp introDone={introDone} />
        </UpdateGate>
      )}
    </View>
  );
}

/**
 * Blocks the app when the running version is below the server's
 * CONFIG_MIN_APP_VERSION. Fails open — until the remote config loads (or if the
 * fetch fails) the app renders normally, so a network blip never locks users
 * out. Only a loaded config that reports a higher minimum shows the gate.
 */
function UpdateGate({ children }: { children: React.ReactNode }) {
  const config = useRemoteConfig();
  if (config.loaded && isUpdateRequired(APP_VERSION, config.minAppVersion)) {
    return <UpdateRequiredScreen />;
  }
  return <>{children}</>;
}

function UpdateRequiredScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={{ alignItems: 'center', backgroundColor: colors.bg, flex: 1, justifyContent: 'center', padding: 32 }}>
      <Image source={require('./assets/aegis/aegis_padded.png')} style={{ height: 72, marginBottom: 24, width: 72 }} />
      <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 22, marginBottom: 12, textAlign: 'center' }}>
        {t('Update required')}
      </Text>
      <Text
        style={{
          color: colors.subtle,
          fontFamily: fonts.monoRegular,
          fontSize: 13,
          lineHeight: 20,
          marginBottom: 28,
          maxWidth: 320,
          textAlign: 'center',
        }}
      >
        {t('A newer version of AEGIS is required to keep your wallet secure. Please update to continue.')}
      </Text>
      <Pressable
        onPress={() => Linking.openURL('https://play.google.com/store/apps/details?id=com.aegis.aegis_ai')}
        style={({ pressed }) => ({
          backgroundColor: colors.primary,
          borderRadius: spacing.radiusSm,
          opacity: pressed ? 0.85 : 1,
          paddingHorizontal: 28,
          paddingVertical: 14,
        })}
      >
        <Text style={{ color: colors.onPrimary, fontFamily: fonts.displaySemi, fontSize: 15 }}>
          {t('Update now')}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Full-res in-app splash (the Flutter app used the same trick): black screen,
 * then after a 50ms beat the logo fades/scales in. Rendering the logo in-app
 * sidesteps Android 12's system splash-icon scaling — the source of the blur.
 */
function IntroSplash({ settled = false }: { settled?: boolean }) {
  const opacity = useRef(new Animated.Value(settled ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(settled ? 1 : 0.94)).current;
  useEffect(() => {
    if (settled) return undefined;
    // One frame is enough to let the first paint commit before the fade begins;
    // 50ms just added visible blank time before the logo appeared.
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 360, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
      ]).start();
    }, 16);
    return () => clearTimeout(timer);
  }, [opacity, scale, settled]);
  return (
    <View style={{ alignItems: 'center', backgroundColor: '#000000', flex: 1, justifyContent: 'center' }}>
      {/* Original raster artwork (1020px glyph), shown at 260dp — physical
          pixels stay below the source on any density, so it only ever
          downscales. The traced-SVG render looked posterized; this doesn't. */}
      <Animated.Image
        source={require('./assets/aegis/splash_logo.png')}
        style={{ height: 178, opacity, transform: [{ scale }], width: 230 }}
        resizeMode="contain"
      />
    </View>
  );
}

function AegisApp({ introDone }: { introDone: boolean }) {
  const { colors } = useTheme();
  const [wallet, setWallet] = useState<any>(null);
  const [auth, setAuth] = useState({ hasPin: false, biometricsEnabled: false, biometricsAvailable: false });
  const [unlocked, setUnlocked] = useState(false);
  const [biometricEnrollmentOpen, setBiometricEnrollmentOpen] = useState(false);
  const [biometricEnrollmentBusy, setBiometricEnrollmentBusy] = useState(false);
  const [biometricEnrollmentError, setBiometricEnrollmentError] = useState('');
  const [pendingWallet, setPendingWallet] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('Agent');
  const [selectedNetwork, setSelectedNetwork] = useState('testnet');
  const [loading, setLoading] = useState(true);
  // On a cold locked launch, Android mounts the lock Modal one layout pass after
  // its parent. Keep the wallet shell out of that first frame so its tab bar can
  // never appear beneath the lock screen. Once shown, it remains mounted for
  // normal background-lock resume behavior.
  const [shellMounted, setShellMounted] = useState(false);
  const [notice, setNotice] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [deeplink, setDeeplink] = useState<any>(null);

  useEffect(() => {
    const apply = (raw: string | null) => {
      const target = parseDappDeeplink(raw);
      if (target) {
        setDeeplink({ url: target, key: Date.now() });
        setActiveTab('Browser');
      }
    };
    Linking.getInitialURL().then(apply).catch(() => {});
    const sub = Linking.addEventListener('url', (event) => apply(event.url));
    return () => sub.remove();
  }, []);

  // Pre-derive the backend-auth signing key while the user is still on the
  // unlock/landing transition — the derivation blocks the JS thread, so it
  // must never run during a screen animation.
  useEffect(() => {
    if (!wallet?.mnemonic || !unlocked) return;
    const task = InteractionManager.runAfterInteractions(() => warmAuthAccount(wallet.mnemonic));
    return () => task.cancel();
  }, [wallet?.mnemonic, unlocked]);

  // Session cache of derived wallets (deriving takes seconds) + the live
  // active id, so walletOps callbacks captured by pushed screens never go stale.
  const derivedRef = useRef(new Map<string, any>());
  const activeIdRef = useRef<string | null>(null);

  const activateEntry = async (entry: any) => {
    let derived = derivedRef.current.get(entry.id);
    if (!derived) {
      derived = await restoreWallet(entry.mnemonic);
      derivedRef.current.set(entry.id, derived);
    }
    const next = { ...derived, id: entry.id, label: entry.label };
    // Derive the auth key before publishing the new wallet to the shell. This
    // keeps the Wallet Manager's switching state visible while JS is busy.
    await warmAuthAccount(entry.mnemonic);
    activeIdRef.current = entry.id;
    await setActiveWalletId(entry.id);
    setWallet(next);
    return next;
  };

  const walletOps = useMemo(
    () => ({
      switch: async (id: string) => {
        const entry = (await getWallets()).find((item) => item.id === id);
        if (!entry) throw new Error('Wallet not found.');
        await activateEntry(entry);
      },
      addAndSelect: async ({ label, mnemonic, derived }: any) => {
        const entry = await addWallet({
          label,
          mnemonic,
          addressPreview: derived?.accounts?.native?.address || '',
        });
        if (derived) derivedRef.current.set(entry.id, derived);
        await activateEntry(entry);
        return entry;
      },

      rename: async (id: string, label: string) => {
        await renameWallet(id, label);
        if (activeIdRef.current === id) {
          setWallet((current: any) => (current ? { ...current, label: label.trim() || current.label } : current));
        }
      },
      remove: async (id: string) => {
        const remaining = await removeWallet(id);
        derivedRef.current.delete(id);
        if (activeIdRef.current !== id) return;
        if (remaining.length) {
          await activateEntry(remaining[0]);
        } else {
          // Last wallet gone: clear auth and return to setup.
          await clearAuth();
          activeIdRef.current = null;
          setWallet(null);
          setPendingWallet(null);
          setUnlocked(false);
          setActiveTab('Agent');
          setShowOnboarding(false);
          setNotice('Wallet removed from this device.');
          const authState = await getAuthState();
          setAuth(authState);
        }
      },
    }),
    [],
  );

  useEffect(() => {
    let mounted = true;
    // Wallet derivation (BIP39 + secp256k1) is CPU-heavy and blocks the JS
    // thread. The splash logo animation is native-driven, so we only need to
    // yield the JS thread briefly for it to START — then the derivation can run
    // underneath it. A short fixed delay does that WITHOUT the long wait that
    // InteractionManager.runAfterInteractions imposes (it blocks until the
    // spring settles, which delayed the unlock screen by several seconds).
    const timer = setTimeout(() => {
      Promise.all([getWallets(), getActiveWalletId(), getAuthState(), getStoredNetwork()])
        .then(async ([wallets, activeId, authState, storedNetwork]) => {
          const entry = wallets.find((item) => item.id === activeId) || wallets[0] || null;
          let loadedWallet = null;
          if (entry) {
            const derived = await restoreWallet(entry.mnemonic);
            derivedRef.current.set(entry.id, derived);
            activeIdRef.current = entry.id;
            loadedWallet = { ...derived, id: entry.id, label: entry.label };
          }
          if (!mounted) return;
          setWallet(loadedWallet);
          setAuth(authState);
          setSelectedNetwork(storedNetwork);
          setUnlocked(!loadedWallet || !authState.hasPin);
          setShellMounted(!loadedWallet || !authState.hasPin);
        })
        .catch((error) => {
          if (mounted) setNotice(error?.message || String(error));
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
    }, 120);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // Lock only on a real `background` transition — `inactive` fires for the
      // notification shade, control center, and system dialogs while the user
      // is still in the app. `isAutoLockSuppressed()` covers the few cases
      // (camera permission) where the OS dialog does report `background`.
      if (state === 'background' && wallet && auth.hasPin && !isAutoLockSuppressed()) {
        setUnlocked(false);
      }
    });
    return () => subscription.remove();
  }, [auth.hasPin, wallet]);

  const refreshAuth = async () => {
    const authState = await getAuthState();
    setAuth(authState);
    return authState;
  };

  const handleWalletCreated = async (nextWallet: any) => {
    setPendingWallet(nextWallet);
    setNotice('');
  };

  const handleNetworkChanged = async (networkKey: string) => {
    const normalized = await saveNetwork(networkKey);
    setSelectedNetwork(normalized);
  };

  const finishPinSetup = async ({ enableBiometrics, promptForBiometrics }: any) => {
    if (!pendingWallet) return;
    // Clear focus before switching from setup to the home composer.
    await dismissKeyboardAndWait(500);
    await walletOps.addAndSelect({
      label: pendingWallet.label || '',
      mnemonic: pendingWallet.mnemonic,
      derived: pendingWallet,
    });
    if (enableBiometrics) await setBiometricsEnabled(true);
    await refreshAuth();
    Keyboard.dismiss();
    setPendingWallet(null);
    setShellMounted(true);
    setUnlocked(true);
    setActiveTab('Agent');
    setNotice('');
    if (promptForBiometrics && !enableBiometrics) setBiometricEnrollmentOpen(true);
  };

  const completeBiometricEnrollment = async (enable: boolean) => {
    setBiometricEnrollmentBusy(true);
    setBiometricEnrollmentError('');
    try {
      if (enable) await setBiometricsEnabled(true);
      await refreshAuth();
      setBiometricEnrollmentOpen(false);
    } catch (caught: any) {
      setBiometricEnrollmentError(caught?.message || 'Biometric setup could not be completed.');
    } finally {
      setBiometricEnrollmentBusy(false);
    }
  };

  const handleUnlock = async () => {
    await refreshAuth();
    // No tab reset: the shell stays mounted under the lock overlay, so the
    // user resumes exactly where they left off (screen, nav stack, inputs).
    setShellMounted(true);
    setUnlocked(true);
  };

  // Root owns the startup beat so the sharp in-app logo appears while fonts
  // initialize, instead of leaving a blank native splash on first launch.

  // Settings "Delete wallet" removes only the ACTIVE wallet; walletOps.remove
  // switches to the next wallet or resets to setup when it was the last one.
  const handleWipe = async () => {
    if (activeIdRef.current) await walletOps.remove(activeIdRef.current);
  };

  if (loading || !introDone) return <IntroSplash settled={introDone} />;

  if (pendingWallet) {
    return (
      <PinSetupScreen
        auth={auth}
        onDone={finishPinSetup}
        onBack={() => setPendingWallet(null)}
        notice={notice}
      />
    );
  }

  if (!wallet) {
    return showOnboarding ? (
      <OnboardingScreen onWallet={handleWalletCreated} notice={notice} onBack={() => setShowOnboarding(false)} />
    ) : (
      <LandingScreen onStart={() => setShowOnboarding(true)} notice={notice} />
    );
  }

  // The lock is an overlay Modal, NOT a replacement screen: MainShell stays
  // mounted underneath, so backgrounding + unlocking returns the user to the
  // exact screen they left, typed input and nav stack intact. A Modal (rather
  // than an absolute View) also covers any natively-stacked sheets that were
  // open when the app locked.
  const locked = auth.hasPin && !unlocked;

  // On the first locked render there is no shell to preserve. Rendering the
  // passcode screen directly avoids Android's delayed native-Modal measurement
  // entirely; later background locks still use the overlay below.
  if (locked && !shellMounted) {
    return <LockScreen auth={auth} onUnlock={handleUnlock} />;
  }

  return (
    <View style={{ flex: 1 }}>
      {shellMounted ? (
        <MainShell
          wallet={wallet}
          auth={auth}
          activeTab={activeTab}
          onTab={setActiveTab}
          notice={notice}
          onDismissNotice={() => setNotice('')}
          onWipe={handleWipe}
          onAuthChanged={refreshAuth}
          selectedNetwork={selectedNetwork}
          onNetworkChanged={handleNetworkChanged}
          deeplink={deeplink}
          onDeeplinkConsumed={() => setDeeplink(null)}
          walletOps={walletOps}
        />
      ) : (
        <View style={{ backgroundColor: '#000000', flex: 1 }} />
      )}
      {biometricEnrollmentOpen && (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => {
            if (!biometricEnrollmentBusy) completeBiometricEnrollment(false);
          }}
        >
          <View style={{ alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.62)', flex: 1, justifyContent: 'center', padding: spacing.screen }}>
            <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 24, borderWidth: 1, maxWidth: 480, padding: 24, width: '100%' }}>
              <View style={{ alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: 34, height: 68, justifyContent: 'center', marginBottom: 16, width: 68 }}>
                <Fingerprint color={colors.accent} size={34} strokeWidth={1.8} />
              </View>
              <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 20 }}>Enable biometric unlock?</Text>
              <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 20, marginTop: 8 }}>
                Unlock Aegis with your fingerprint or face instead of entering your passcode.
              </Text>
              {!!biometricEnrollmentError && <Text style={{ color: colors.negative, fontSize: 13, marginTop: 12 }}>{biometricEnrollmentError}</Text>}
              <View style={{ gap: 10, marginTop: 22 }}>
                <Button label="Enable" onPress={() => completeBiometricEnrollment(true)} disabled={biometricEnrollmentBusy} loading={biometricEnrollmentBusy} />
                <Button label="Not now" variant="secondary" onPress={() => completeBiometricEnrollment(false)} disabled={biometricEnrollmentBusy} />
              </View>
            </View>
          </View>
        </Modal>
      )}
      {locked && (
        <Modal visible transparent={false} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => {}}>
          {/* A Modal is its own native window, so the outer safe-area context
              doesn't reach it — its insets measure late and the keypad's bottom
              gets cropped for a beat. Seeding a fresh provider with the initial
              window metrics makes the insets correct on the very first frame. */}
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <LockScreen auth={auth} onUnlock={handleUnlock} />
          </SafeAreaProvider>
        </Modal>
      )}
    </View>
  );
}

function MainShell({
  wallet,
  auth,
  activeTab,
  onTab,
  notice,
  onDismissNotice,
  onWipe,
  onAuthChanged,
  selectedNetwork,
  onNetworkChanged,
  deeplink,
  onDeeplinkConsumed,
  walletOps,
}: any) {
  // Persists the browser's active URL across tab switches (tab screens remount
  // on every switch). Empty = the dapp launcher; a URL = resume that page.
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserNavigation, setBrowserNavigation] = useState<any>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [swapPrefill, setSwapPrefill] = useState<any>(null);
  const [activityKey, setActivityKey] = useState(0);
  const [connectionsKey, setConnectionsKey] = useState(0);
  const [walletsKey, setWalletsKey] = useState(0);
  const [contactsKey, setContactsKey] = useState(0);
  const [newChatKey, setNewChatKey] = useState(0);
  const [openChat, setOpenChat] = useState<any>(null);

  // One-shot menu actions: screens call this after handling their key so a
  // tab remount doesn't re-trigger the push (tabs remount on every switch).
  const consumeAction = (name: string) => {
    if (name === 'activity') setActivityKey(0);
    if (name === 'connections') setConnectionsKey(0);
    if (name === 'wallets') setWalletsKey(0);
    if (name === 'contacts') setContactsKey(0);
    if (name === 'chat') setOpenChat(null);
  };

  const jumpToTab = useCallback((tab: string) => {
    Keyboard.dismiss();
    setDrawerOpen(false);
    onTab(tab);
  }, [onTab]);

  const openInBrowser = useCallback((url: string) => {
    setBrowserUrl(url);
    setBrowserNavigation({ key: Date.now(), url });
    jumpToTab('Browser');
  }, [jumpToTab]);

  const screen = useMemo(() => {
    switch (activeTab) {
      case 'Wallet':
        return (
          <AssetsScreen
            wallet={wallet}
            auth={auth}
            selectedNetwork={selectedNetwork}
            onMenu={() => setDrawerOpen(true)}
            onSwapToken={(denom: string) => {
              setSwapPrefill({ denom, key: Date.now() });
              jumpToTab('Swap');
            }}
            onOpenBrowser={openInBrowser}
            openActivityKey={activityKey}
            consumeAction={consumeAction}
          />
        );
      case 'Browser':
        // Rendered separately and kept permanently mounted (see `browser`
        // below) so its live WebView survives tab switches.
        return null;
      case 'Swap':
        return <SwapScreen wallet={wallet} auth={auth} selectedNetwork={selectedNetwork} prefill={swapPrefill} />;
      case 'Identity':
        return (
          <SettingsScreen
            wallet={wallet}
            auth={auth}
            selectedNetwork={selectedNetwork}
            onNetworkChanged={onNetworkChanged}
            onWipe={onWipe}
            onAuthChanged={onAuthChanged}
            onBack={() => jumpToTab('Agent')}
          />
        );
      default:
        return (
          <HomeScreen
            wallet={wallet}
            auth={auth}
            walletOps={walletOps}
            walletsKey={walletsKey}
            contactsKey={contactsKey}
            newChatKey={newChatKey}
            openChat={openChat}
            consumeAction={consumeAction}
            notice={notice}
            onDismissNotice={onDismissNotice}
            onMenu={() => setDrawerOpen(true)}
            onTab={jumpToTab}
            selectedNetwork={selectedNetwork}
          />
        );
    }
  }, [activeTab, activityKey, auth, connectionsKey, contactsKey, jumpToTab, newChatKey, notice, onAuthChanged, onDismissNotice, onNetworkChanged, onWipe, openChat, openInBrowser, selectedNetwork, swapPrefill, wallet, walletOps, walletsKey]);

  // The browser stays permanently mounted (hidden with display:none when
  // another tab is active) so its WebView keeps its live session — logged-in
  // dapps, scroll, in-page state — instead of reloading on every tab switch.
  // Cold starts still open on the launcher because `browserUrl` is in-memory.
  const browser = useMemo(
    () => (
      <BrowserScreen
        url={browserUrl}
        navigationRequest={browserNavigation}
        onUrl={setBrowserUrl}
        wallet={wallet}
        auth={auth}
        selectedNetwork={selectedNetwork}
        onNetworkChanged={onNetworkChanged}
        connectionsKey={connectionsKey}
        deeplink={deeplink}
        consumeAction={consumeAction}
        onDeeplinkConsumed={onDeeplinkConsumed}
        active={activeTab === 'Browser'}
      />
    ),
    [browserUrl, browserNavigation, wallet, auth, selectedNetwork, onNetworkChanged, connectionsKey, deeplink, onDeeplinkConsumed, activeTab],
  );
  const onBrowser = activeTab === 'Browser';

  return (
    <NavProvider>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <TopSafeArea>
        {/* Both slots are laid out; display:none keeps the hidden one
            mounted (and, for the browser, keeps its WebView alive). */}
        <View style={{ display: onBrowser ? 'none' : 'flex', flex: 1 }}>{screen}</View>
        <View style={{ display: onBrowser ? 'flex' : 'none', flex: 1 }}>{browser}</View>
          </TopSafeArea>
      </KeyboardAvoidingView>
      <TabBar activeTab={activeTab} onTab={jumpToTab} />
      <SideMenu
          visible={drawerOpen}
          wallet={wallet}
          onClose={() => setDrawerOpen(false)}
          onOpenChat={(chat: any) => {
            setDrawerOpen(false);
            setOpenChat({ id: chat.id, title: chat.title, key: Date.now() });
            jumpToTab('Agent');
          }}
          onSelect={(tab: string) => {
            setDrawerOpen(false);
            if (tab === 'NewChat') {
              setNewChatKey(Date.now());
              jumpToTab('Agent');
              return;
            }
            if (tab === 'Activity') {
              setActivityKey(Date.now());
              jumpToTab('Wallet');
              return;
            }
            if (tab === 'Connections') {
              setConnectionsKey(Date.now());
              jumpToTab('Browser');
              return;
            }
            if (tab === 'Bridge') {
              setSwapPrefill({ mode: 'bridge', key: Date.now() });
              jumpToTab('Swap');
              return;
            }
            if (tab === 'Wallets') {
              setWalletsKey(Date.now());
              jumpToTab('Agent');
              return;
            }
            if (tab === 'Contacts') {
              setContactsKey(Date.now());
              jumpToTab('Agent');
              return;
            }
            jumpToTab(tab);
          }}
        />
    </NavProvider>
  );
}

/**
 * Top/side safe-area padding with a hard Android fallback: on the very first
 * frames the inset context can still report 0 (content renders under the
 * status bar until the async native measurement lands). StatusBar.currentHeight
 * is available synchronously, so the max of the two is always correct.
 */
function TopSafeArea({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0);
  return (
    <View style={{ flex: 1, paddingLeft: insets.left, paddingRight: insets.right, paddingTop: topInset }}>
      {children}
    </View>
  );
}

function TabBar({ activeTab, onTab }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderWidth: 1,
        borderBottomWidth: 0,
        paddingBottom: insets.bottom,
      }}
    >
      <View style={{ flexDirection: 'row', height: TAB_BAR_HEIGHT, paddingHorizontal: 8 }}>
        {bottomTabs.map(({ key, label, Icon }) => {
          const active = activeTab === key;
          return (
            <Pressable
              key={key}
              onPress={() => onTab(key)}
              style={{ alignItems: 'center', flex: 1, justifyContent: 'center', gap: 4 }}
            >
              <Icon
                color={active ? colors.accent : colors.subtle}
                size={21}
                strokeWidth={active ? 2.4 : 2}
              />
              <Text
                style={{
                  color: active ? colors.text : colors.subtle,
                  fontFamily: fonts.mono,
                  fontSize: 9.5,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                {t(label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const menuItems = [
  { key: 'NewChat', label: 'New chat', hint: 'Start a fresh agent chat', Icon: Bot },
  { key: 'Wallets', label: 'Wallets', hint: 'Switch or add wallets', Icon: WalletCards },
  { key: 'Contacts', label: 'Contacts', hint: 'Saved addresses', Icon: BookUser },
  { key: 'Activity', label: 'Activity', hint: 'Transaction history', Icon: History },
  { key: 'Connections', label: 'Dapp connections', hint: 'Manage connected sites', Icon: Plug },
  { key: 'Identity', label: 'Settings', hint: 'Network, security, theme', Icon: Settings },
];

/** "2h ago"-style stamp for the recent-chat rows. */
function relativeTime(iso: string, t: (text: string) => string = (text) => text) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return t('Just now');
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

function SideMenu({ visible, wallet, onClose, onSelect, onOpenChat }: any) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [recentChats, setRecentChats] = useState<any[]>([]);
  const [chatsOpen, setChatsOpen] = useState(false);
  // Remaining daily chat credits, seeded from the cache the agent screen keeps
  // fresh on every send (null until the server has ever answered).
  const creditsKey = `credits.${wallet?.accounts?.evm?.address || 'none'}`;
  const [credits, setCredits] = useState<number | null>(() => getCachedSync(creditsKey) ?? null);

  // Refresh the list each time the drawer opens (collapsed again by default);
  // stale results are fine to show meanwhile, so no spinner.
  useEffect(() => {
    if (!visible || !wallet?.mnemonic) return;
    setChatsOpen(false);
    setCredits(getCachedSync(creditsKey) ?? null);
    let active = true;
    fetchConversations(wallet).then((rows) => {
      if (active) setRecentChats(rows);
    });
    fetchCredits(wallet).then((remaining) => {
      if (active && remaining !== null) setCredits(remaining);
    });
    return () => {
      active = false;
    };
  }, [visible, wallet]);
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View
          style={{
            backgroundColor: colors.bg,
            borderRightColor: colors.border,
            borderRightWidth: 1,
            paddingBottom: insets.bottom + 16,
            paddingHorizontal: 16,
            paddingTop: insets.top + 16,
            width: '80%',
          }}
        >
          <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
              <Image source={require('./assets/aegis/aegis_padded.png')} style={{ height: 34, width: 34 }} />
              <Text style={{ color: colors.text, fontFamily: fonts.display, fontSize: 16, letterSpacing: 1.5 }}>
                AEGIS
              </Text>
            </View>
            <IconBtn onPress={onClose} size={36}>
              <X color={colors.text} size={18} strokeWidth={2.2} />
            </IconBtn>
          </View>

          {credits !== null && (
            <View
              style={{
                alignItems: 'center',
                backgroundColor: credits === 0 ? colors.accentSoft : colors.surface,
                borderColor: credits === 0 ? 'transparent' : colors.border,
                borderRadius: spacing.radiusSm,
                borderWidth: credits === 0 ? 0 : 1,
                flexDirection: 'row',
                gap: 10,
                marginBottom: 14,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <Bot color={credits === 0 ? colors.negative : colors.accent} size={16} strokeWidth={2} />
              <Text
                style={{
                  color: credits === 0 ? colors.negative : colors.subtle,
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  letterSpacing: 0.6,
                }}
              >
                {credits === 0 ? t('OUT OF CHATS') : `${credits} ${t('CHATS LEFT')}`}
              </Text>
            </View>
          )}

          <ScrollView showsVerticalScrollIndicator={false}>
            {menuItems.map(({ key, label, hint, Icon }) => (
              <Pressable
                key={key}
                onPress={() => onSelect(key)}
                style={({ pressed }) => ({
                  alignItems: 'center',
                  backgroundColor: pressed ? colors.cardPressed : 'transparent',
                  borderRadius: spacing.radiusSm,
                  flexDirection: 'row',
                  gap: 14,
                  marginBottom: 4,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                })}
              >
                <View
                  style={{
                    alignItems: 'center',
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: 12,
                    borderWidth: 1,
                    height: 40,
                    justifyContent: 'center',
                    width: 40,
                  }}
                >
                  <Icon color={colors.accent} size={18} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 15 }}>{t(label)}</Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.faint,
                      fontFamily: fonts.monoRegular,
                      fontSize: 10.5,
                      letterSpacing: 0.3,
                      marginTop: 3,
                    }}
                  >
                    {t(hint)}
                  </Text>
                </View>
              </Pressable>
            ))}

            {recentChats.length > 0 && (
              <>
                <Pressable
                  onPress={() => setChatsOpen((current) => !current)}
                  hitSlop={6}
                  style={({ pressed }) => ({
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                    marginTop: 18,
                    opacity: pressed ? 0.7 : 1,
                    paddingHorizontal: 12,
                  })}
                >
                  <Text
                    style={{
                      color: colors.faint,
                      fontFamily: fonts.mono,
                      fontSize: 10,
                      letterSpacing: 1.4,
                      textTransform: 'uppercase',
                    }}
                  >
                    {`${t('Recent chats')} (${recentChats.length})`}
                  </Text>
                  {chatsOpen ? (
                    <ChevronDown color={colors.subtle} size={14} strokeWidth={2.2} />
                  ) : (
                    <ChevronRight color={colors.subtle} size={14} strokeWidth={2.2} />
                  )}
                </Pressable>
                {chatsOpen && recentChats.map((chat: any) => (
                  <Pressable
                    key={chat.id}
                    onPress={() => onOpenChat(chat)}
                    style={({ pressed }) => ({
                      alignItems: 'center',
                      backgroundColor: pressed ? colors.cardPressed : 'transparent',
                      borderRadius: spacing.radiusSm,
                      flexDirection: 'row',
                      gap: 12,
                      marginBottom: 2,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                    })}
                  >
                    <MessageSquare color={colors.subtle} size={15} strokeWidth={2} />
                    <Text
                      numberOfLines={1}
                      style={{ color: colors.text, flex: 1, fontSize: 13.5 }}
                    >
                      {chat.title}
                    </Text>
                    <Text style={{ color: colors.faint, fontFamily: fonts.mono, fontSize: 10 }}>
                      {relativeTime(chat.lastAt, t)}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}
          </ScrollView>
        </View>
        <Pressable style={{ backgroundColor: colors.overlay, flex: 1 }} onPress={onClose} />
      </View>
    </Modal>
  );
}
