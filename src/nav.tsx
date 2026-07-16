import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Dimensions, Easing, StyleSheet, View } from 'react-native';

type StackEntry = {
  key: number;
  node: React.ReactNode;
  anim: Animated.Value;
};

type Nav = {
  push: (node: React.ReactNode) => void;
  pop: () => void;
  popAll: () => void;
  depth: number;
};

const NavContext = createContext<Nav>({ push: () => {}, pop: () => {}, popAll: () => {}, depth: 0 });

export function useNav() {
  return useContext(NavContext);
}

/**
 * Lightweight push stack: pushed nodes cover the whole shell (including the
 * tab bar) and slide in from the right. Hardware back pops the top screen.
 */
export function NavProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<StackEntry[]>([]);
  const stackRef = useRef<StackEntry[]>([]);
  stackRef.current = stack;
  const keyRef = useRef(0);

  const lastPushRef = useRef(0);

  const push = useCallback((node: React.ReactNode) => {
    // Swallow double-taps: two pushes within 300ms are almost always the same
    // button pressed twice.
    const now = Date.now();
    if (now - lastPushRef.current < 300) return;
    lastPushRef.current = now;
    keyRef.current += 1;
    // Build the entry OUTSIDE the state updater and make the updater
    // idempotent — React may invoke updaters twice (dev-mode purity checks),
    // which would otherwise push duplicate entries with the same key.
    const entry: StackEntry = { key: keyRef.current, node, anim: new Animated.Value(0) };
    setStack((current) =>
      current.some((item) => item.key === entry.key) ? current : [...current, entry],
    );
    Animated.timing(entry.anim, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  const pop = useCallback(() => {
    const top = stackRef.current[stackRef.current.length - 1];
    if (!top) return;
    Animated.timing(top.anim, {
      toValue: 0,
      duration: 230,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setStack((current) => current.filter((entry) => entry.key !== top.key));
    });
  }, []);

  const popAll = useCallback(() => {
    setStack([]);
  }, []);

  useEffect(() => {
    if (!stack.length) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      pop();
      return true;
    });
    return () => sub.remove();
  }, [pop, stack.length]);

  const width = Dimensions.get('window').width;

  return (
    <NavContext.Provider value={{ push, pop, popAll, depth: stack.length }}>
      <View style={styles.root}>
        {children}
        {stack.map((entry) => (
          <Animated.View
            key={entry.key}
            style={[
              StyleSheet.absoluteFill,
              {
                transform: [
                  {
                    translateX: entry.anim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [width, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {entry.node}
          </Animated.View>
        ))}
      </View>
    </NavContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
