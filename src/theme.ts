import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'system' | 'dark' | 'light';

export type Palette = {
  bg: string;
  surface: string;
  card: string;
  cardPressed: string;
  border: string;
  borderSoft: string;
  text: string;
  muted: string;
  subtle: string;
  faint: string;
  accent: string;
  accentSoft: string;
  primary: string;
  onPrimary: string;
  positive: string;
  negative: string;
  warning: string;
  overlay: string;
};

export const darkPalette: Palette = {
  bg: '#0C0C0A',
  surface: '#131311',
  card: '#1A1915',
  cardPressed: '#21201A',
  border: '#2B2A23',
  borderSoft: '#21201B',
  text: '#F2EFE6',
  muted: '#B7B2A4',
  subtle: '#8D897B',
  faint: '#5E5B50',
  accent: '#E3D9B8',
  accentSoft: 'rgba(227, 217, 184, 0.10)',
  primary: '#E9E0C2',
  onPrimary: '#14130E',
  positive: '#A3C299',
  negative: '#E29187',
  warning: '#D9B36C',
  overlay: 'rgba(0, 0, 0, 0.62)',
};

export const lightPalette: Palette = {
  bg: '#F1EFE6',
  surface: '#FAF8F1',
  card: '#FFFFFF',
  cardPressed: '#F5F3EA',
  border: '#E8E4D7',
  borderSoft: '#F0EDE2',
  text: '#1A1913',
  muted: '#57544A',
  subtle: '#85816F',
  faint: '#B3AF9F',
  accent: '#75683C',
  accentSoft: 'rgba(117, 104, 60, 0.10)',
  primary: '#1A1913',
  onPrimary: '#F7F5EC',
  positive: '#4C7A44',
  negative: '#B34A3D',
  warning: '#97782F',
  overlay: 'rgba(24, 23, 17, 0.42)',
};

export const fonts = {
  display: 'Sora_700Bold',
  displaySemi: 'Sora_600SemiBold',
  displayMedium: 'Sora_500Medium',
  mono: 'IBMPlexMono_500Medium',
  monoRegular: 'IBMPlexMono_400Regular',
  monoSemi: 'IBMPlexMono_600SemiBold',
};

export const spacing = {
  screen: 20,
  gap: 12,
  cardPad: 18,
  radius: 20,
  radiusSm: 14,
  radiusXs: 10,
};

const THEME_KEY = 'aegis.qore.theme.v1';

export async function getStoredThemeMode(): Promise<ThemeMode> {
  const stored = await SecureStore.getItemAsync(THEME_KEY);
  return stored === 'dark' || stored === 'light' ? stored : 'system';
}

export async function saveThemeMode(mode: ThemeMode) {
  await SecureStore.setItemAsync(THEME_KEY, mode);
}
