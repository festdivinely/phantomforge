import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { BarChart } from '../../components/BarChart';
import { Button, Empty, ErrorBanner, Loading, Stat, StatusPill } from '../../components/ui';
import { useSession } from '../../lib/connection';
import { dayKey, describeCron, kindLabel, timeAgo, timeUntil } from '../../lib/format';
import { colors, ui } from '../../lib/theme';
import type { AccountStats, KindCounts } from '../../lib/types';
import { useLoader } from '../../lib/useLoader';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'last7Days', label: '7 days' },
  { key: 'last30Days', label: '30 days' },
  { key: 'allTime', label: 'All time' },
] as const;

const CHART_KINDS = ['connection_accept', 'connection_request', 'connection_withdraw', 'post_create'] as const;
const CHART_DAYS = 14;

export default function AccountScreen() {
  const { id, label, platform } = useLocalSearchParams<{ id: string; label?: string; platform?: string }>();
  const { session, call } = useSession();
  const [loggingIn, setLoggingIn] = useState(false);

  const logInAgain = async () => {
    setLoggingIn(true);
    try {
      const { id: loginId } = await call<{ id: string }>('/api/login-sessions', {
        method: 'POST',
        body: { organizationId: session.orgId, identityId: id },
      });
      router.push({ pathname: '/login/[id]', params: { id: loginId } });
    } catch (err) {
      Alert.alert('Could not start the login', err instanceof Error ? err.message : String(err));
    } finally {
      setLoggingIn(false);
    }
  };
  const { data, error, refreshing, refresh, reload } = useLoader(
    () => call<AccountStats>(`/api/accounts/${id}/stats`),
    30_000,
  );
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('today');
  const [chartKind, setChartKind] = useState<(typeof CHART_KINDS)[number]>('connection_accept');
  const [toggling, setToggling] = useState<string>();

  const bars = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const row of data?.daily ?? []) if (row.kind === chartKind) byDay.set(row.day, row.ok);
    return Array.from({ length: CHART_DAYS }, (_, i) => {
      const day = dayKey(new Date(Date.now() - (CHART_DAYS - 1 - i) * 86_400_000));
      return { label: day, value: byDay.get(day) ?? 0 };
    });
  }, [data, chartKind]);

  const toggleSchedule = async (scheduleId: string, enabled: boolean) => {
    setToggling(scheduleId);
    try {
      await call(`/api/schedules/${scheduleId}`, { method: 'PATCH', body: { enabled } });
      await reload();
    } catch (err) {
      Alert.alert('Could not change the schedule', err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(undefined);
    }
  };

  const title = data?.identity.label ?? label ?? 'Account';
  if (!data && !error)
    return (
      <>
        <Stack.Screen options={{ title }} />
        <Loading />
      </>
    );

  const counts: KindCounts | undefined = data?.[period];

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
    >
      <Stack.Screen options={{ title }} />
      <ErrorBanner error={error} onRetry={() => void reload()} />
      {data && (
        <>
          <View style={[ui.card, ui.row, { justifyContent: 'space-between' }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <StatusPill status={data.identity.status} />
              {data.identity.statusReason ? <Text style={{ color: colors.warn }}>{data.identity.statusReason}</Text> : null}
              {platform === 'linkedin' && data.identity.status !== 'active' && (
                <Button small title="Log in again" onPress={() => void logInAgain()} busy={loggingIn} />
              )}
            </View>
            {data.pendingPosts > 0 && (
              <Button small title={`${data.pendingPosts} post${data.pendingPosts > 1 ? 's' : ''} waiting`} onPress={() => router.navigate('/posts')} />
            )}
          </View>

          <Button
            kind="secondary"
            title="Posting profile (for Claude drafts)"
            onPress={() => router.push({ pathname: '/profile/[id]', params: { id } })}
          />

          <View style={ui.card}>
            <Chips options={PERIODS} value={period} onChange={setPeriod} />
            <View style={[ui.row, { flexWrap: 'wrap' }]}>
              {CHART_KINDS.map((kind) => (
                <Stat
                  key={kind}
                  label={kindLabel(kind)}
                  value={counts?.[kind]?.ok ?? 0}
                  sub={counts?.[kind]?.failed ? `${counts[kind].failed} failed` : undefined}
                />
              ))}
            </View>
          </View>

          <View style={ui.card}>
            <Text style={ui.title}>Last {CHART_DAYS} days</Text>
            <Chips
              options={CHART_KINDS.map((k) => ({ key: k, label: kindLabel(k) }))}
              value={chartKind}
              onChange={setChartKind}
            />
            <BarChart bars={bars} />
          </View>

          <Text style={ui.sectionTitle}>Today's safety limits</Text>
          <View style={ui.card}>
            {data.quotaToday.map((q) => {
              const share = q.limit ? Math.min(1, q.used / q.limit) : 1;
              return (
                <View key={q.action} style={{ gap: 4 }}>
                  <View style={[ui.row, { justifyContent: 'space-between' }]}>
                    <Text style={ui.text}>{kindLabel(q.action)}</Text>
                    <Text style={ui.muted}>
                      {q.used} / {q.limit}
                    </Text>
                  </View>
                  <View style={{ height: 6, backgroundColor: colors.input, borderRadius: 3 }}>
                    <View
                      style={{
                        height: 6,
                        width: `${share * 100}%`,
                        borderRadius: 3,
                        backgroundColor: share >= 1 ? colors.bad : share >= 0.8 ? colors.warn : colors.good,
                      }}
                    />
                  </View>
                </View>
              );
            })}
          </View>

          <Text style={ui.sectionTitle}>Schedules</Text>
          {data.schedules.length === 0 && <Empty>No schedules for this account yet.</Empty>}
          {data.schedules.map((s) => (
            <View key={s.id} style={[ui.card, ui.row, { justifyContent: 'space-between' }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={ui.text}>{s.agentConfig.name}</Text>
                <Text style={ui.muted}>
                  {describeCron(s.cron)} ({s.timezone})
                </Text>
                <Text style={ui.muted}>
                  {s.enabled
                    ? `Next ${s.nextRunAt ? timeUntil(s.nextRunAt) : 'not booked'} · last ${timeAgo(s.lastRunAt)}`
                    : `Paused · last ${timeAgo(s.lastRunAt)}`}
                </Text>
              </View>
              <Switch
                value={s.enabled}
                disabled={toggling === s.id}
                onValueChange={(v) => void toggleSchedule(s.id, v)}
                trackColor={{ true: colors.accent, false: colors.cardBorder }}
                accessibilityLabel={`${s.enabled ? 'Pause' : 'Resume'} ${s.agentConfig.name}`}
              />
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Chips<K extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ key: K; label: string }>;
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View style={[ui.row, { flexWrap: 'wrap' }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 99,
              backgroundColor: on ? colors.accent : colors.input,
            }}
          >
            <Text style={{ color: on ? colors.accentText : colors.muted, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
