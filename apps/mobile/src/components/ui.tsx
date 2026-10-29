import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiError } from '../lib/api';
import { colors, ui } from '../lib/theme';
import type { IdentityStatus, PostStatus } from '../lib/types';

type ButtonKind = 'primary' | 'secondary' | 'danger';

export function Button({
  title,
  onPress,
  kind = 'primary',
  busy = false,
  disabled = false,
  small = false,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  busy?: boolean;
  disabled?: boolean;
  small?: boolean;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        small && styles.small,
        kind === 'primary' && { backgroundColor: colors.accent },
        kind === 'secondary' && { backgroundColor: colors.cardBorder },
        kind === 'danger' && { backgroundColor: '#3a1414', borderColor: colors.bad, borderWidth: 1 },
        (pressed || off) && { opacity: 0.6 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={[styles.buttonText, kind === 'danger' && { color: colors.bad }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/** Shows an API error; offers the fix when the address or token is the problem. */
export function ErrorBanner({ error, onRetry }: { error: ApiError | undefined; onRetry?: () => void }) {
  if (!error) return null;
  const connectionProblem = error.unreachable || error.unauthorized;
  return (
    <View style={[ui.card, { borderColor: colors.bad }]}>
      <Text style={ui.text}>{error.message}</Text>
      <View style={ui.row}>
        {onRetry && <Button small kind="secondary" title="Try again" onPress={onRetry} />}
        {connectionProblem && (
          <Button small title="Change server address" onPress={() => router.push('/connect')} />
        )}
      </View>
    </View>
  );
}

export function Loading() {
  return (
    <View style={[ui.screen, { alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <View style={[ui.card, { alignItems: 'center', paddingVertical: 28 }]}>
      <Text style={[ui.muted, { textAlign: 'center' }]}>{children}</Text>
    </View>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: colors.good,
  published: colors.good,
  approved: colors.accent,
  publishing: colors.accent,
  pending_approval: colors.warn,
  expired: colors.warn,
  challenged: colors.warn,
  restricted: colors.bad,
  failed: colors.bad,
  rejected: colors.muted,
  disabled: colors.muted,
};

const STATUS_TEXT: Record<string, string> = {
  pending_approval: 'waiting for you',
  expired: 'logged out',
  challenged: 'needs verification',
};

export function StatusPill({ status }: { status: IdentityStatus | PostStatus }) {
  const color = STATUS_COLORS[status] ?? colors.muted;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{STATUS_TEXT[status] ?? status}</Text>
    </View>
  );
}

export function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={ui.muted}>{label}</Text>
      {sub ? <Text style={[ui.muted, { color: colors.bad, fontSize: 11 }]}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { minHeight: 36, paddingHorizontal: 12 },
  buttonText: { color: colors.accentText, fontWeight: '600', fontSize: 15 },
  pill: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '600' },
  stat: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: colors.input,
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '700' },
});
