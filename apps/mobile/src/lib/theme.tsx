import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

const dark = {
  bg: '#0b0f14',
  card: '#141a22',
  cardBorder: '#1f2733',
  text: '#e6edf3',
  muted: '#8b98a5',
  accent: '#3b82f6',
  accentText: '#ffffff',
  good: '#22c55e',
  warn: '#f59e0b',
  bad: '#ef4444',
  dangerBg: '#3a1414',
  input: '#0f141b',
};

/** Same meanings as the dark palette, with darker accents so text stays readable on white. */
const light: typeof dark = {
  bg: '#f4f6f9',
  card: '#ffffff',
  cardBorder: '#d9dfe7',
  text: '#111827',
  muted: '#5b6573',
  accent: '#2563eb',
  accentText: '#ffffff',
  good: '#15803d',
  warn: '#b45309',
  bad: '#dc2626',
  dangerBg: '#fdecec',
  input: '#eef1f5',
};

export type Colors = typeof dark;
export type Scheme = 'light' | 'dark';
/** What the owner picked in Settings; "system" follows the phone. */
export type ThemeMode = 'system' | Scheme;

function makeUi(colors: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, gap: 12 },
    card: {
      backgroundColor: colors.card,
      borderColor: colors.cardBorder,
      borderWidth: 1,
      borderRadius: 12,
      padding: 14,
      gap: 8,
    },
    title: { color: colors.text, fontSize: 17, fontWeight: '600' },
    text: { color: colors.text, fontSize: 15 },
    muted: { color: colors.muted, fontSize: 13 },
    sectionTitle: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginTop: 8,
    },
    input: {
      backgroundColor: colors.input,
      borderColor: colors.cardBorder,
      borderWidth: 1,
      borderRadius: 10,
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  });
}

export type Ui = ReturnType<typeof makeUi>;

// Built once per palette, not on every render.
const THEMES = {
  dark: { scheme: 'dark' as Scheme, colors: dark, ui: makeUi(dark) },
  light: { scheme: 'light' as Scheme, colors: light, ui: makeUi(light) },
};

interface ThemeValue {
  scheme: Scheme;
  colors: Colors;
  ui: Ui;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const STORE_KEY = 'pf.theme';
const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    void SecureStore.getItemAsync(STORE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') setModeState(saved);
      })
      .catch(() => undefined);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void SecureStore.setItemAsync(STORE_KEY, next).catch(() => undefined);
  }, []);

  const scheme: Scheme = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
  const value = useMemo(() => ({ ...THEMES[scheme], mode, setMode }), [scheme, mode, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The current colours and shared styles; screens re-render when the theme changes. */
export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

/** Per-component styles that follow the theme: `const useStyles = makeStyles((c) => ({...}))`. */
export function makeStyles<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(build: (colors: Colors) => T) {
  const cache = new Map<Colors, T>();
  return function useStyles(): T {
    const { colors } = useTheme();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(build(colors));
      cache.set(colors, styles);
    }
    return styles;
  };
}
