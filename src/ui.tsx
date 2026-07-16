import { ChevronLeft } from 'lucide-react-native';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Image,
  Keyboard,
  NativeModules,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import Reanimated, {
  Easing as ReEasing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './ThemeContext';
import { fonts, spacing } from './theme';

export const TAB_BAR_HEIGHT = 62;

type AndroidKeyboardLayout = 'pan' | 'resize';

async function setAndroidKeyboardLayout(mode: AndroidKeyboardLayout): Promise<void> {
  if (Platform.OS !== 'android') return;
  await (NativeModules as any).AegisKeyboardLayout?.setMode(mode);
}

const AnimatedView: any = Animated.View;
/**
 * Clear focus without delaying the action that triggered it. Android resizes the
 * window itself; waiting for an IME animation before state changes is what caused
 * the unreliable first tap and stale bottom padding.
 */
export function dismissKeyboardAndWait(_timeoutMs?: number): Promise<void> {
  const inputState = (TextInput as any).State;
  const focusedInput = inputState?.currentlyFocusedInput?.();
  focusedInput?.blur?.();
  if (focusedInput && inputState?.blurTextInput) inputState.blurTextInput(focusedInput);
  Keyboard.dismiss();
  return Promise.resolve();
}

export const SheetTextInput = BottomSheetTextInput;

function PulsingDot({ index, color, size }: { index: number; color: string; size: number }) {
  const pulse = useSharedValue(0.3);
  useEffect(() => {
    pulse.value = withDelay(
      index * 160,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320, easing: ReEasing.inOut(ReEasing.ease) }),
          withTiming(0.3, { duration: 320, easing: ReEasing.inOut(ReEasing.ease) }),
          withTiming(0.3, { duration: 320 }),
        ),
        -1,
        false,
      ),
    );
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ scale: pulse.value }],
  }));
  return (
    <Reanimated.View
      style={[{ backgroundColor: color, borderRadius: size / 2, height: size, width: size }, style]}
    />
  );
}

/**
 * Three dots that pulse in sequence — our loading indicator (no spinners).
 * Driven by Reanimated on the UI thread, so it keeps animating even while the
 * JS thread is blocked (e.g. during key derivation).
 */
export function LoadingDots({ color, size = 6 }: { color?: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', flexDirection: 'row', gap: size * 0.7 }}>
      {[0, 1, 2].map((index) => (
        <PulsingDot key={index} index={index} color={color || colors.accent} size={size} />
      ))}
    </View>
  );
}

/** Mount animation: content slides in from the right. Used for setup screens
 * that live outside the push-nav stack. */
export function SlideIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const anim = useRef(new Animated.Value(0)).current;
  const width = Dimensions.get('window').width;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <AnimatedView
      style={[
        { flex: 1, transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }) }] },
        style,
      ]}
    >
      {children}
    </AnimatedView>
  );
}

const tokenIcons: Record<string, any> = {
  QOR: require('../assets/aegis/tokens/qore.png'),
  USDC: require('../assets/aegis/tokens/usdc.png'),
  USDT: require('../assets/aegis/tokens/usdt.png'),
  ETH: require('../assets/aegis/tokens/eth.png'),
  SOL: require('../assets/aegis/tokens/sol.png'),
  wQOR: require('../assets/aegis/tokens/qore.png'),
  'QOR-EVM': require('../assets/aegis/tokens/qore.png'),
  'QOR-SVM': require('../assets/aegis/tokens/qore.png'),
  QUSDT: require('../assets/aegis/tokens/usdt.png'),
};

/* ---------------------------------- layout --------------------------------- */

/**
 * Standard pull-to-refresh: returns a themed <RefreshControl/> to hand to a
 * Screen/PushedScreen. `onRefresh` kicks the reload (e.g. bumps a refreshKey);
 * the spinner shows for a short minimum so it reads as a deliberate refresh.
 */
export function usePullRefresh(onRefresh: () => void, minMs = 900) {
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const trigger = useCallback(() => {
    setRefreshing(true);
    onRefresh();
    setTimeout(() => setRefreshing(false), minMs);
  }, [onRefresh, minMs]);
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={trigger}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.card}
    />
  );
}

export function Screen({
  children,
  scroll = true,
  bottom = 'tabs',
  style,
  refreshControl,
}: {
  children: ReactNode;
  scroll?: boolean;
  bottom?: 'tabs' | 'safe' | 'none' | number;
  style?: StyleProp<ViewStyle>;
  refreshControl?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const paddingBottom =
    typeof bottom === 'number'
      ? bottom
      : bottom === 'tabs'
        ? insets.bottom + TAB_BAR_HEIGHT + 28
        : bottom === 'safe'
          ? insets.bottom + 24
          : 0;
  if (!scroll) {
    return <View style={[{ flex: 1, paddingHorizontal: spacing.screen }, style]}>{children}</View>;
  }
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[
        { flexGrow: 1, paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom },
        style,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl as any}
    >
      {/* ScrollView handles blank-space keyboard dismissal itself. Avoid a
          parent touch handler here: it can interrupt a child Pressable after a
          keyboard resize, leaving only the button label reliably tappable. */}
      <View style={{ flexGrow: 1 }}>{children}</View>
    </ScrollView>
  );
}

/** Full-screen pushed page: opaque background, safe top inset, centered-title back header. */
export function PushedScreen({
  title,
  onBack,
  right,
  children,
  scroll = true,
  footer,
  refreshControl,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  refreshControl?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Pushed screens are absoluteFill overlays (see NavProvider) that sit
  // OUTSIDE the root KeyboardAvoidingView, so adjustResize / KAV never
  // moves their footer. We animate paddingBottom on the root container
  // to push the footer above the keyboard ourselves.
  const kbPadding = useSharedValue(0);
  useEffect(() => {
    if (!footer) return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      kbPadding.value = withTiming(e.endCoordinates.height, { duration: 250, easing: ReEasing.out(ReEasing.ease) });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      kbPadding.value = withTiming(0, { duration: 200, easing: ReEasing.out(ReEasing.ease) });
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, [!!footer]);
  const kbStyle = useAnimatedStyle(() => ({
    paddingBottom: kbPadding.value,
  }));

  return (
    <Reanimated.View style={[{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }, footer ? kbStyle : undefined]}>
      <View style={pushedStyles.header}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.displaySemi,
              fontSize: 18,
              maxWidth: '60%',
              textAlign: 'center',
            }}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
        <IconBtn
          onPress={() => {
            // If the keyboard is up, the back tap closes it first; a second
            // tap then navigates back. Feels native and avoids ghost padding.
            if ((TextInput as any).State?.currentlyFocusedInput?.()) {
              Keyboard.dismiss();
              return;
            }
            onBack();
          }}
        >
          <ChevronLeft color={colors.text} size={22} strokeWidth={2.2} />
        </IconBtn>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      <Screen scroll={scroll} bottom={footer ? 28 : 'safe'} refreshControl={refreshControl}>
        {children}
      </Screen>
      {!!footer && (
        <View
          style={{
            paddingHorizontal: spacing.screen,
            paddingTop: 12,
            paddingBottom: insets.bottom + 16,
            gap: 10,
          }}
        >
          {footer}
        </View>
      )}
    </Reanimated.View>
  );
}

const pushedStyles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: spacing.screen,
    paddingVertical: 10,
  },
});

/* ------------------------------- typography -------------------------------- */

/** Mono micro-label — the "registry plate" tag every card carries. */
export function Eyebrow({
  children,
  tone = 'subtle',
  style,
}: {
  children: ReactNode;
  tone?: 'subtle' | 'accent';
  style?: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        {
          color: tone === 'accent' ? colors.accent : colors.subtle,
          fontFamily: fonts.mono,
          fontSize: 10.5,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 10,
        marginTop: 26,
        paddingHorizontal: 2,
      }}
    >
      <Eyebrow>{title}</Eyebrow>
      {!!action && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text
            style={{
              color: colors.accent,
              fontFamily: fonts.mono,
              fontSize: 11,
              letterSpacing: 0.8,
              textTransform: 'uppercase',
            }}
          >
            {action}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Sora amount with tabular figures, for balances. */
export function AmountText({
  children,
  size = 38,
  color,
  style,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Text
      adjustsFontSizeToFit
      numberOfLines={1}
      style={[
        {
          color: color || colors.text,
          fontFamily: fonts.display,
          fontSize: size,
          fontVariant: ['tabular-nums'],
          letterSpacing: -0.5,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/* ---------------------------------- cards ---------------------------------- */

/**
 * Focus glow for text inputs: accent border (+ soft accent shadow on iOS)
 * while the input inside is focused. Spread `inputProps` onto the TextInput
 * and merge `style` into the bordered container (a Card or the input itself).
 */
export function useFocusGlow() {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  // Border color ONLY — toggling shadow/elevation props mid-focus restructures
  // the native view tree on Android (view unflattening), which detaches the
  // TextInput and instantly closes the keyboard.
  const style = focused ? { borderColor: colors.accent } : null;
  return {
    focused,
    style,
    inputProps: {
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
  };
}

export function Card({
  children,
  eyebrow,
  eyebrowRight,
  onPress,
  pad = true,
  style,
}: {
  children: ReactNode;
  eyebrow?: string;
  eyebrowRight?: ReactNode;
  onPress?: () => void;
  pad?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, isDark } = useTheme();
  const base: ViewStyle = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: spacing.radius,
    borderWidth: 1,
    overflow: 'hidden',
    padding: pad ? spacing.cardPad : 0,
    // In light mode, cards sit on warm paper — a soft drop shadow separates
    // them far better than a hard outline does.
    ...(isDark
      ? null
      : {
          elevation: 2,
          shadowColor: '#7A7256',
          shadowOffset: { width: 0, height: 5 },
          shadowOpacity: 0.08,
          shadowRadius: 14,
        }),
  };
  const content = (
    <>
      {(eyebrow || eyebrowRight) && (
        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 12,
            paddingHorizontal: pad ? 0 : spacing.cardPad,
            paddingTop: pad ? 0 : spacing.cardPad,
          }}
        >
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : <View />}
          {eyebrowRight}
        </View>
      )}
      {children}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [base, pressed && { backgroundColor: colors.cardPressed }, style]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{content}</View>;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.borderSoft,
        height: StyleSheet.hairlineWidth,
        marginLeft: inset,
      }}
    />
  );
}

/** Generic list row for use inside a `Card pad={false}`. */
export function ListRow({
  leading,
  title,
  titleRight,
  sub,
  trailing,
  onPress,
  first,
}: {
  leading?: ReactNode;
  title: string;
  titleRight?: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  first?: boolean;
}) {
  const { colors } = useTheme();
  const body = (
    <>
      {leading}
      <View style={{ flex: 1, marginLeft: leading ? 12 : 0 }}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
          <Text
            style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 15 }}
            numberOfLines={1}
          >
            {title}
          </Text>
          {titleRight}
        </View>
        {!!sub && (
          <View style={{ marginTop: 3 }}>
            {typeof sub === 'string' ? (
              <Text style={{ color: colors.subtle, fontSize: 12.5 }} numberOfLines={1}>
                {sub}
              </Text>
            ) : (
              sub
            )}
          </View>
        )}
      </View>
      {trailing}
    </>
  );
  const rowStyle: ViewStyle = {
    alignItems: 'center',
    borderTopColor: colors.borderSoft,
    borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: spacing.cardPad,
    paddingVertical: 14,
  };
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [rowStyle, pressed && { backgroundColor: colors.cardPressed }]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={rowStyle}>{body}</View>;
}

export function KeyValue({
  label,
  value,
  mono,
  first,
  selectable = true,
  onPress,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  first?: boolean;
  selectable?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const row = (
    <View
      style={{
        alignItems: 'flex-start',
        borderTopColor: colors.borderSoft,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        flexDirection: 'row',
        gap: 16,
        justifyContent: 'space-between',
        paddingVertical: 12,
      }}
    >
      <Text style={{ color: colors.subtle, flexShrink: 0, fontSize: 13 }}>{label}</Text>
      <Text
        selectable={selectable}
        style={{
          color: colors.text,
          flexShrink: 1,
          fontFamily: mono ? fonts.monoRegular : undefined,
          fontSize: mono ? 12 : 13,
          fontWeight: mono ? undefined : '600',
          textAlign: 'right',
        }}
      >
        {value ?? 'Not configured'}
      </Text>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.7 }}>
        {row}
      </Pressable>
    );
  }
  return row;
}

/* --------------------------------- controls -------------------------------- */

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  small,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
}) {
  const { colors } = useTheme();
  const inactive = Boolean(disabled || loading || !onPress);
  const trigger = () => {
    if (!inactive && onPress) onPress();
  };
  const backgrounds = {
    primary: colors.primary,
    secondary: 'transparent',
    danger: 'transparent',
    ghost: 'transparent',
  };
  const borders = {
    primary: colors.primary,
    secondary: colors.border,
    danger: colors.negative,
    ghost: 'transparent',
  };
  const labels = {
    primary: colors.onPrimary,
    secondary: colors.text,
    danger: colors.negative,
    ghost: colors.accent,
  };
  return (
    <Pressable
      // Keep the full padded surface as a native Android touch target.
      collapsable={false}
      pointerEvents="box-only"
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(loading), disabled: inactive }}
      onPress={trigger}
      style={({ pressed }) => ({
        alignItems: 'center',
        alignSelf: 'stretch',
        backgroundColor: backgrounds[variant],
        borderColor: borders[variant],
        borderRadius: spacing.radiusSm,
        borderWidth: variant === 'ghost' ? 0 : 1,
        justifyContent: 'center',
        minHeight: small ? 42 : 52,
        opacity: inactive ? 0.45 : pressed ? 0.82 : 1,
        paddingHorizontal: 18,
      })}
    >
      {loading ? (
        <LoadingDots color={labels[variant]} />
      ) : (
        <Text style={{ color: labels[variant], fontFamily: fonts.displaySemi, fontSize: 14 }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function IconBtn({
  children,
  onPress,
  size = 42,
  active = false,
}: {
  children: ReactNode;
  onPress?: () => void;
  size?: number;
  active?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: active ? colors.accentSoft : pressed ? colors.cardPressed : colors.surface,
        borderColor: active ? colors.accent : colors.border,
        borderRadius: size / 2,
        borderWidth: 1,
        height: size,
        justifyContent: 'center',
        width: size,
      })}
    >
      {children}
    </Pressable>
  );
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'accent' | 'positive' | 'negative';
}) {
  const { colors } = useTheme();
  const palette = {
    neutral: { bg: colors.surface, border: colors.border, text: colors.muted },
    accent: { bg: colors.accentSoft, border: 'transparent', text: colors.accent },
    positive: { bg: colors.accentSoft, border: 'transparent', text: colors.positive },
    negative: { bg: colors.accentSoft, border: 'transparent', text: colors.negative },
  }[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: palette.bg,
        borderColor: palette.border,
        borderRadius: 7,
        borderWidth: tone === 'neutral' ? 1 : 0,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      <Text
        style={{
          color: palette.text,
          fontFamily: fonts.mono,
          fontSize: 10,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function Toggle({ active, onPress }: { active?: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={8}
      style={{
        backgroundColor: active ? colors.accent : colors.surface,
        borderColor: active ? colors.accent : colors.border,
        borderRadius: 999,
        borderWidth: 1,
        height: 28,
        padding: 3,
        width: 48,
      }}
    >
      <View
        style={{
          alignSelf: active ? 'flex-end' : 'flex-start',
          backgroundColor: active ? colors.onPrimary : colors.faint,
          borderRadius: 999,
          height: 20,
          width: 20,
        }}
      />
    </Pressable>
  );
}

/* --------------------------------- feedback -------------------------------- */

export function Notice({
  text,
  tone = 'info',
  onPress,
}: {
  text: string;
  tone?: 'info' | 'error';
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{
        backgroundColor: colors.card,
        borderColor: tone === 'error' ? colors.negative : colors.border,
        borderRadius: spacing.radiusSm,
        borderWidth: 1,
        marginBottom: 14,
        padding: 14,
      }}
    >
      <Text
        style={{
          color: tone === 'error' ? colors.negative : colors.muted,
          fontSize: 13,
          fontWeight: '600',
          lineHeight: 19,
        }}
      >
        {text}
      </Text>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 20, paddingVertical: 28 }}>
      {!!icon && (
        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: 26,
            borderWidth: 1,
            height: 52,
            justifyContent: 'center',
            marginBottom: 14,
            width: 52,
          }}
        >
          {icon}
        </View>
      )}
      <Text style={{ color: colors.text, fontFamily: fonts.displaySemi, fontSize: 15 }}>
        {title}
      </Text>
      {!!body && (
        <Text
          style={{ color: colors.subtle, fontSize: 13, lineHeight: 19, marginTop: 5, textAlign: 'center' }}
        >
          {body}
        </Text>
      )}
    </View>
  );
}

/* ---------------------------------- assets --------------------------------- */

export function TokenIcon({ symbol, size = 40 }: { symbol: string; size?: number }) {
  const { colors } = useTheme();
  const source = tokenIcons[symbol];
  if (!source) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: size / 2,
          borderWidth: 1,
          height: size,
          justifyContent: 'center',
          width: size,
        }}
      >
        <Text
          style={{
            color: colors.accent,
            fontFamily: fonts.displaySemi,
            fontSize: Math.max(10, size * 0.32),
            letterSpacing: 0.5,
          }}
        >
          {String(symbol || '?').slice(0, 2).toUpperCase()}
        </Text>
      </View>
    );
  }
  return <Image source={source} style={{ borderRadius: size / 2, height: size, width: size }} />;
}

/* ---------------------------------- sheets --------------------------------- */

/**
 * Shared bottom sheet. It is rendered through the app's portal instead of a
 * React Native Modal, so Android has exactly one owner for keyboard insets.
 */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const modalRef = useRef<any>(null);
  const presentedRef = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const handleDismiss = useCallback(() => {
    presentedRef.current = false;
    void setAndroidKeyboardLayout('resize');
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      void setAndroidKeyboardLayout('pan').then(() => {
        if (!visibleRef.current) {
          void setAndroidKeyboardLayout('resize');
          return;
        }
        requestAnimationFrame(() => {
          if (!visibleRef.current) return;
          modalRef.current?.present();
          presentedRef.current = true;
        });
      });
    } else if (presentedRef.current) {
      modalRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => () => {
    void setAndroidKeyboardLayout('resize');
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!visible) return false;
      modalRef.current?.dismiss();
      return true;
    });
    return () => subscription.remove();
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.76}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={modalRef}
      enableDynamicSizing
      maxDynamicContentSize={Dimensions.get('window').height * 0.86}
      topInset={insets.top + 12}
      bottomInset={insets.bottom}
      enablePanDownToClose
      enableContentPanningGesture={false}
      enableBlurKeyboardOnGesture
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustPan"
      backgroundStyle={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        borderWidth: 1,
      }}
      handleIndicatorStyle={{ backgroundColor: colors.border, width: 40 }}
      backdropComponent={renderBackdrop}
      onDismiss={handleDismiss}
    >
      <BottomSheetView style={{ paddingBottom: 16, paddingHorizontal: spacing.screen }}>
        {children}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

export function TokenSelectSheet({
  visible,
  onClose,
  tokens,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  tokens: any[];
  onSelect: (token: any) => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Eyebrow style={{ marginBottom: 10 }}>Select asset</Eyebrow>
      <Card pad={false}>
        <ScrollView style={{ maxHeight: 420 }}>
          {tokens.map((token, index) => (
            <ListRow
              key={token.symbol || token.denom}
              first={index === 0}
              leading={<TokenIcon symbol={token.symbol} size={36} />}
              title={token.symbol}
              sub={token.name}
              trailing={
                token.balance ? (
                  <Text style={{ color: colors.muted, fontFamily: fonts.monoRegular, fontSize: 12 }}>
                    {token.balanceDisplay || token.balance}
                  </Text>
                ) : undefined
              }
              onPress={() => {
                onSelect(token);
                onClose();
              }}
            />
          ))}
        </ScrollView>
      </Card>
    </Sheet>
  );
}
