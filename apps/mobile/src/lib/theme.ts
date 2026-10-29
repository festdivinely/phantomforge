import { StyleSheet } from 'react-native';

/** One dark palette for the whole app; the dashboard is dark too. */
export const colors = {
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
  input: '#0f141b',
};

export const ui = StyleSheet.create({
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
