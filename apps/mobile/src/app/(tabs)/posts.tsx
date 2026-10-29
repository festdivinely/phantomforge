import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Empty, ErrorBanner, Loading, StatusPill } from '../../components/ui';
import { useSession } from '../../lib/connection';
import { dateTime, timeAgo } from '../../lib/format';
import { colors, ui } from '../../lib/theme';
import type { AccountOverview, PostDraft } from '../../lib/types';
import { useLoader } from '../../lib/useLoader';

const MAX_LENGTH = 3000;

/** Post approvals: nothing is ever published until the owner approves it here or in Telegram. */
export default function PostsScreen() {
  const { session, call } = useSession();
  const org = session.orgId;
  const { data, error, refreshing, refresh, reload } = useLoader(async () => {
    const [pending, recent, accounts] = await Promise.all([
      call<PostDraft[]>(`/api/posts?organizationId=${org}&status=pending_approval&limit=50`),
      call<PostDraft[]>(`/api/posts?organizationId=${org}&limit=30`),
      call<AccountOverview[]>(`/api/accounts/overview?organizationId=${org}`),
    ]);
    return { pending, history: recent.filter((p) => p.status !== 'pending_approval'), accounts };
  }, 20_000);

  if (!data && !error) return <Loading />;

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={ui.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
      >
        <ErrorBanner error={error} onRetry={() => void reload()} />
        {data && (
          <>
            <Compose accounts={data.accounts} onCreated={reload} />

            <Text style={ui.sectionTitle}>Waiting for you ({data.pending.length})</Text>
            {data.pending.length === 0 && <Empty>No posts are waiting for approval.</Empty>}
            {data.pending.map((post) => (
              <PendingPost key={post.id} post={post} onDone={reload} />
            ))}

            <Text style={ui.sectionTitle}>Recent</Text>
            {data.history.length === 0 && <Empty>No decided posts yet.</Empty>}
            {data.history.map((post) => (
              <View key={post.id} style={ui.card}>
                <View style={[ui.row, { justifyContent: 'space-between' }]}>
                  <Text style={ui.muted}>{post.identity?.label ?? 'Account'}</Text>
                  <StatusPill status={post.status} />
                </View>
                <Text style={ui.text} numberOfLines={4}>
                  {post.text}
                </Text>
                <Text style={ui.muted}>
                  {post.publishedAt
                    ? `Published ${dateTime(post.publishedAt)}`
                    : post.status === 'approved' && post.scheduledFor
                      ? `Publishes ${dateTime(post.scheduledFor)}`
                      : `Decided ${timeAgo(post.decidedAt ?? post.createdAt)}`}
                </Text>
                {post.error ? <Text style={{ color: colors.bad }}>{post.error}</Text> : null}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PendingPost({ post, onDone }: { post: PostDraft; onDone: () => Promise<void> }) {
  const { call } = useSession();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(post.text);
  const [busy, setBusy] = useState<'approve' | 'reject'>();

  const act = async (action: 'approve' | 'reject') => {
    setBusy(action);
    try {
      await call(`/api/posts/${post.id}/${action}`, {
        method: 'POST',
        body: action === 'approve' && editing && text.trim() !== post.text ? { text: text.trim() } : {},
      });
      await onDone();
    } catch (err) {
      Alert.alert('That did not work', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  };

  const confirmSkip = () =>
    Alert.alert('Skip this post?', 'It will not be published.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Skip', style: 'destructive', onPress: () => void act('reject') },
    ]);

  return (
    <View style={[ui.card, { borderColor: colors.warn }]}>
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <Text style={ui.muted}>
          {post.identity?.label ?? 'Account'} · by {post.source} · {timeAgo(post.createdAt)}
        </Text>
      </View>
      {editing ? (
        <TextInput
          style={[ui.input, { minHeight: 120, textAlignVertical: 'top' }]}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={MAX_LENGTH}
          autoFocus
        />
      ) : (
        <Text style={ui.text}>{post.text}</Text>
      )}
      {post.scheduledFor ? <Text style={ui.muted}>Planned for {dateTime(post.scheduledFor)}</Text> : null}
      <View style={[ui.row, { flexWrap: 'wrap' }]}>
        <Button
          small
          title={editing ? 'Save and approve' : 'Approve'}
          onPress={() => void act('approve')}
          busy={busy === 'approve'}
          disabled={!!busy || (editing && !text.trim())}
        />
        <Button
          small
          kind="secondary"
          title={editing ? 'Cancel edit' : 'Edit'}
          onPress={() => {
            setText(post.text);
            setEditing(!editing);
          }}
          disabled={!!busy}
        />
        <Button small kind="danger" title="Skip" onPress={confirmSkip} busy={busy === 'reject'} disabled={!!busy} />
      </View>
    </View>
  );
}

function Compose({ accounts, onCreated }: { accounts: AccountOverview[]; onCreated: () => Promise<void> }) {
  const { session, call } = useSession();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [accountId, setAccountId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const chosen = accountId ?? accounts[0]?.id;

  if (!open)
    return <Button kind="secondary" title="Write a new post" onPress={() => setOpen(true)} disabled={accounts.length === 0} />;

  const save = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await call('/api/posts', {
        method: 'POST',
        body: { organizationId: session.orgId, identityId: chosen, text: text.trim(), source: 'owner' },
      });
      setText('');
      setOpen(false);
      await onCreated();
    } catch (err) {
      Alert.alert('Could not save the post', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={ui.card}>
      <Text style={ui.title}>New post</Text>
      {accounts.length > 1 && (
        <View style={[ui.row, { flexWrap: 'wrap' }]}>
          {accounts.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => setAccountId(a.id)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 99,
                backgroundColor: a.id === chosen ? colors.accent : colors.input,
              }}
            >
              <Text style={{ color: colors.text, fontSize: 13 }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <TextInput
        style={[ui.input, { minHeight: 120, textAlignVertical: 'top' }]}
        value={text}
        onChangeText={setText}
        placeholder="What do you want to share?"
        placeholderTextColor={colors.muted}
        multiline
        maxLength={MAX_LENGTH}
      />
      <Text style={ui.muted}>
        {text.length} / {MAX_LENGTH}. It is saved as waiting for approval; approve it below to publish.
      </Text>
      <View style={ui.row}>
        <Button small title="Save draft" onPress={() => void save()} busy={busy} disabled={!text.trim() || !chosen} />
        <Button small kind="secondary" title="Cancel" onPress={() => setOpen(false)} disabled={busy} />
      </View>
    </View>
  );
}
