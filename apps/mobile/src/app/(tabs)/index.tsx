import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Empty, ErrorBanner, Loading, Stat, StatusPill } from '../../components/ui';
import { useSession } from '../../lib/connection';
import { KIND_VERBS, timeAgo } from '../../lib/format';
import { colors, ui } from '../../lib/theme';
import type { AccountOverview } from '../../lib/types';
import { useLoader } from '../../lib/useLoader';

/** Home: every account with today's growth numbers. */
export default function AccountsScreen() {
  const { session, call } = useSession();
  const { data, error, refreshing, refresh, reload } = useLoader(
    () => call<AccountOverview[]>(`/api/accounts/overview?organizationId=${session.orgId}`),
    30_000,
  );

  if (!data && !error) return <Loading />;

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={ui.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
    >
      <ErrorBanner error={error} onRetry={() => void reload()} />
      {data?.length === 0 && <Empty>No accounts yet. Add one in the dashboard on the PC.</Empty>}
      {data?.map((account) => {
        const t = account.today;
        const last = account.lastActivity;
        return (
          <Pressable
            key={account.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/account/[id]', params: { id: account.id, label: account.label } })}
            style={({ pressed }) => [ui.card, pressed && { opacity: 0.7 }]}
          >
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.title}>{account.label}</Text>
              <StatusPill status={account.status} />
            </View>
            <Text style={ui.muted}>
              {account.platform}
              {account.accountName ? ` · ${account.accountName}` : ''}
            </Text>
            {account.status !== 'active' && account.statusReason ? (
              <Text style={{ color: colors.warn }}>{account.statusReason}</Text>
            ) : null}
            <Text style={ui.sectionTitle}>Today</Text>
            <View style={[ui.row, { flexWrap: 'wrap' }]}>
              <Stat label="Accepted" value={t.connection_accept?.ok ?? 0} />
              <Stat label="Requests" value={t.connection_request?.ok ?? 0} />
              <Stat label="Withdrawn" value={t.connection_withdraw?.ok ?? 0} />
              <Stat label="Posts" value={t.post_create?.ok ?? 0} />
            </View>
            <Text style={ui.muted}>
              {last
                ? `Last: ${KIND_VERBS[last.kind] ?? last.kind}${last.targetName ? ` ${last.targetName}` : ''} · ${timeAgo(last.occurredAt)}${last.succeeded ? '' : ' (failed)'}`
                : 'No activity yet'}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
