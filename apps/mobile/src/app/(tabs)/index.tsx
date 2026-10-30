import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Empty, ErrorBanner, Loading, Stat, StatusPill } from '../../components/ui';
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
      {data?.length === 0 && <Empty>No accounts yet. Add your LinkedIn account below.</Empty>}
      {data?.map((account) => {
        const t = account.today;
        const last = account.lastActivity;
        return (
          <Pressable
            key={account.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/account/[id]', params: { id: account.id, label: account.label, platform: account.platform } })}
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
      {data && <AddLinkedInAccount orgId={session.orgId} />}
    </ScrollView>
  );
}

/** Starts a remote login that adds a new LinkedIn account. */
function AddLinkedInAccount({ orgId }: { orgId: string }) {
  const { call } = useSession();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const { id } = await call<{ id: string }>('/api/login-sessions', {
        method: 'POST',
        body: { organizationId: orgId, label: label.trim() },
      });
      setLabel('');
      router.push({ pathname: '/login/[id]', params: { id } });
    } catch (err) {
      Alert.alert('Could not start the login', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={ui.card}>
      <Text style={ui.title}>Add a LinkedIn account</Text>
      <Text style={ui.muted}>
        You log in on LinkedIn's own page, shown live from the server. Your password goes straight to LinkedIn and is
        never saved.
      </Text>
      <TextInput
        style={ui.input}
        value={label}
        onChangeText={setLabel}
        placeholder="A name for it, e.g. My LinkedIn"
        placeholderTextColor={colors.muted}
        maxLength={100}
      />
      <Button title="Log in to LinkedIn" onPress={() => void start()} busy={busy} disabled={!label.trim()} />
    </View>
  );
}
