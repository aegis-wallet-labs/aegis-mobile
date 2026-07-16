import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { darkPalette, getStoredThemeMode, lightPalette, Palette, saveThemeMode, ThemeMode } from './theme';

type Theme = {
  colors: Palette;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<Theme>({
  colors: darkPalette,
  isDark: true,
  mode: 'system',
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    getStoredThemeMode().then(setModeState).catch(() => {});
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    saveThemeMode(next).catch(() => {});
  };

  const isDark = mode === 'system' ? system !== 'light' : mode === 'dark';
  const value = useMemo<Theme>(
    () => ({ colors: isDark ? darkPalette : lightPalette, isDark, mode, setMode }),
    [isDark, mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
