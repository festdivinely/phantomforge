import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Empty, ErrorBanner, Loading, StatusPill } from '../../components/ui';
import { useSession } from '../../lib/connection';
import { dateTime, timeAgo } from '../../lib/format';
import { colors, ui } from '../../lib/theme';
import { ApiError } from '../../lib/api';
import type { AccountOverview, DraftJob, PostDraft } from '../../lib/types';
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
            <DraftWithClaude accounts={data.accounts} onDrafted={reload} />
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

const COUNTS = [1, 3, 5] as const;
const POLL_MS = 3_000;

/** Asks Claude for drafts, then follows the job until the drafts arrive. */
function DraftWithClaude({ accounts, onDrafted }: { accounts: AccountOverview[]; onDrafted: () => Promise<void> }) {
  const { call } = useSession();
  const [accountId, setAccountId] = useState<string>();
  const [count, setCount] = useState<(typeof COUNTS)[number]>(3);
  const [hint, setHint] = useState('');
  const [status, setStatus] = useState<{ busy: boolean; text?: string; needsProfile?: boolean; ok?: boolean }>({
    busy: false,
  });
  const chosen = accountId ?? accounts[0]?.id;

  const follow = async (jobId: string) => {
    // Claude takes a little while to write; check every few seconds, give up after ~4 minutes.
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const job = await call<DraftJob>(`/api/posts/draft/${jobId}`);
      if (job.state === 'completed') {
        await onDrafted();
        return setStatus({ busy: false, ok: true, text: `${job.made ?? 0} new draft${job.made === 1 ? '' : 's'} below.` });
      }
      if (job.state === 'failed') return setStatus({ busy: false, text: job.error ?? 'Drafting failed.' });
      setStatus({ busy: true, text: job.state === 'delayed' ? 'Busy at Claude, retrying shortly...' : 'Claude is writing...' });
    }
    setStatus({ busy: false, text: 'Still writing. The drafts will appear here (and in Telegram) when ready.' });
  };

  const start = async () => {
    if (!chosen) return;
    setStatus({ busy: true, text: 'Sending...' });
    try {
      const { jobId } = await call<{ jobId: string }>('/api/posts/draft', {
        method: 'POST',
        body: { identityId: chosen, count, hint: hint.trim() || undefined },
      });
      setHint('');
      await follow(jobId);
    } catch (err) {
      const needsProfile = err instanceof ApiError && err.status === 409;
      setStatus({ busy: false, needsProfile, text: err instanceof Error ? err.message : String(err) });
    }
  };

  if (accounts.length === 0) return null;

  return (
    <View style={ui.card}>
      <Text style={ui.title}>Draft with Claude</Text>
      <Text style={ui.muted}>Claude writes posts from the account's posting profile. Each one waits for you below.</Text>
      {accounts.length > 1 && (
        <View style={[ui.row, { flexWrap: 'wrap' }]}>
          {accounts.map((a) => (
            <Chip key={a.id} label={a.label} on={a.id === chosen} onPress={() => setAccountId(a.id)} />
          ))}
        </View>
      )}
      <View style={ui.row}>
        <Text style={ui.muted}>How many:</Text>
        {COUNTS.map((n) => (
          <Chip key={n} label={String(n)} on={n === count} onPress={() => setCount(n)} />
        ))}
      </View>
      <TextInput
        style={ui.input}
        value={hint}
        onChangeText={setHint}
        placeholder="Optional idea, e.g. what I learned shipping my app"
        placeholderTextColor={colors.muted}
        maxLength={500}
      />
      {status.text ? (
        <Text style={{ color: status.ok ? colors.good : status.busy ? colors.muted : colors.bad }}>{status.text}</Text>
      ) : null}
      <View style={[ui.row, { flexWrap: 'wrap' }]}>
        <Button small title={`Write ${count} draft${count > 1 ? 's' : ''}`} onPress={() => void start()} busy={status.busy} />
        {status.needsProfile && chosen && (
          <Button
            small
            kind="secondary"
            title="Set up posting profile"
            onPress={() => router.push({ pathname: '/profile/[id]', params: { id: chosen } })}
          />
        )}
      </View>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: on ? colors.accent : colors.input }}
    >
      <Text style={{ color: on ? colors.accentText : colors.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
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
