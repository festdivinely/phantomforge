import * as SecureStore from 'expo-secure-store';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Empty } from '../../components/ui';
import { useSession } from '../../lib/connection';
import { timeAgo } from '../../lib/format';
import { useTheme } from '../../lib/theme';
import type { AccountStats } from '../../lib/types';

/**
 * "Who I'd send to": a practice run lists people from LinkedIn search (nothing
 * is clicked), the owner ticks who to invite, and only those get a request.
 * The send tool searches again and still applies every rule and limit.
 */

interface Person {
  name: string;
  headline: string;
  location?: string;
  profileUrl: string;
  status: string;
  search?: string;
}

interface Run {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  errorMessage: string | null;
  input: { search?: string; only?: string[] };
  output: { results?: Person[] } | null;
  queuedAt: string;
  finishedAt: string | null;
  logs?: Array<{ message: string }>;
}

/** A list older than this is found again before sending: search results move. */
const STALE_MS = 24 * 3_600_000;
const POLL_MS = 3_000;
const done = (r?: Run) => !!r && ['succeeded', 'failed', 'cancelled'].includes(r.status);

export default function InviteScreen() {
  const { colors, ui } = useTheme();
  const { id, label } = useLocalSearchParams<{ id: string; label?: string }>();
  const { session, call } = useSession();
  const storeKey = `pf.invite.${id}`;

  const [ids, setIds] = useState<{ preview?: string; send?: string }>({});
  const [preview, setPreview] = useState<Run>();
  const [send, setSend] = useState<Run>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [left, setLeft] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  // Runs live on the server: leaving the screen loses nothing, so remember which ones are ours.
  useEffect(() => {
    void SecureStore.getItemAsync(storeKey)
      .then((v) => v && setIds(JSON.parse(v) as typeof ids))
      .catch(() => undefined);
  }, [storeKey]);
  const remember = useCallback(
    (next: typeof ids) => {
      setIds(next);
      void SecureStore.setItemAsync(storeKey, JSON.stringify(next)).catch(() => undefined);
    },
    [storeKey],
  );

  const loadLeft = useCallback(async () => {
    const stats = await call<AccountStats>(`/api/accounts/${id}/stats`).catch(() => undefined);
    const q = stats?.quotaToday.find((x) => x.action === 'connection_request');
    if (q) setLeft(Math.max(0, q.limit - q.used));
  }, [call, id]);
  useEffect(() => void loadLeft(), [loadLeft]);

  // Follow both runs until they finish (finished ones are not asked again).
  useEffect(() => {
    let stop = false;
    const finished = new Set<string>();
    const follow = async (runId: string | undefined, set: (r: Run) => void) => {
      if (!runId || finished.has(runId)) return;
      const r = await call<Run>(`/api/runs/${runId}`).catch(() => undefined);
      if (stop || !r) return;
      set(r);
      if (done(r)) finished.add(runId);
    };
    const tick = async () => {
      await follow(ids.preview, setPreview);
      const wasRunning = !!ids.send && !finished.has(ids.send);
      await follow(ids.send, setSend);
      if (wasRunning && ids.send && finished.has(ids.send)) void loadLeft();
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [ids, call, loadLeft]);

  const people = useMemo(() => (preview?.output?.results ?? []).filter((p) => p.status === 'would invite'), [preview]);
  const skipped = useMemo(() => (preview?.output?.results ?? []).filter((p) => p.status.startsWith('skipped')), [preview]);
  const search = people[0]?.search ?? preview?.input.search;
  const stale = !!preview?.finishedAt && Date.now() - new Date(preview.finishedAt).getTime() > STALE_MS;

  // Tick as many as today's limit allows, in the order LinkedIn listed them.
  useEffect(() => {
    if (preview?.status === 'succeeded' && !ids.send) {
      setPicked(new Set(people.slice(0, left ?? people.length).map((p) => p.profileUrl)));
    }
  }, [preview?.status, people, left, ids.send]);

  const toggle = (url: string) => {
    const next = new Set(picked);
    if (next.has(url)) next.delete(url);
    else if (left !== undefined && next.size >= left) {
      Alert.alert("Today's limit", `This account can send ${left} more request${left === 1 ? '' : 's'} today. Untick someone first.`);
      return;
    } else next.add(url);
    setPicked(next);
  };

  const findPeople = async () => {
    setBusy(true);
    try {
      const run = await call<Run>('/api/runs', {
        method: 'POST',
        body: {
          organizationId: session.orgId,
          identityId: id,
          agentKey: 'linkedin.send-connection',
          input: { dryRun: true, max: 10, maxPages: 3 },
        },
      });
      setPreview(run);
      setSend(undefined);
      remember({ preview: run.id });
    } catch (err) {
      Alert.alert('Could not start', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const sendNow = () => {
    const only = people.filter((p) => picked.has(p.profileUrl)).map((p) => p.profileUrl);
    Alert.alert(
      `Send ${only.length} request${only.length === 1 ? '' : 's'}?`,
      `From ${label ?? 'this account'}, without a note. Each person is found again in the same search and checked against the rules first.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setBusy(true);
            try {
              const run = await call<Run>('/api/runs', {
                method: 'POST',
                body: {
                  organizationId: session.orgId,
                  identityId: id,
                  agentKey: 'linkedin.send-connection',
                  input: { search, only, max: only.length, maxPages: 3 },
                },
              });
              setSend(run);
              remember({ preview: ids.preview, send: run.id });
            } catch (err) {
              Alert.alert('Could not start', err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const working = (r?: Run) =>
    r && !done(r) ? (
      <View style={[ui.card, ui.row]}>
        <ActivityIndicator color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={ui.text}>{r.status === 'queued' ? 'Waiting to start…' : 'Working on LinkedIn…'}</Text>
          <Text style={ui.muted}>{r.logs?.at(-1)?.message ?? 'This takes a few minutes, like a person browsing. You can leave this screen.'}</Text>
        </View>
      </View>
    ) : null;

  const failed = (r?: Run) =>
    r && (r.status === 'failed' || r.status === 'cancelled') ? (
      <View style={[ui.card, { backgroundColor: colors.dangerBg }]}>
        <Text style={{ color: colors.bad, fontWeight: '600' }}>Stopped</Text>
        <Text style={ui.text}>{r.errorMessage ?? 'The run was cancelled.'}</Text>
      </View>
    ) : null;

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
      <Stack.Screen options={{ title: 'Who to invite' }} />

      <View style={ui.card}>
        <Text style={ui.text}>
          I look through LinkedIn search for people who say they want connections, and list them here. Nothing is sent
          until you tick people and press Send.
        </Text>
        {left !== undefined && <Text style={ui.muted}>Requests left today: {left}</Text>}
        <Button
          title={preview ? 'Find people again' : 'Find people'}
          onPress={() => void findPeople()}
          busy={busy}
          disabled={(!!preview && !done(preview)) || (!!send && !done(send))}
        />
      </View>

      {working(preview)}
      {failed(preview)}

      {preview?.status === 'succeeded' && !send && (
        <>
          <Text style={ui.sectionTitle}>
            {people.length} {people.length === 1 ? 'person' : 'people'} · search "{search}" · {timeAgo(preview.finishedAt)}
          </Text>
          {stale && (
            <Text style={{ color: colors.warn }}>This list is over a day old. Find people again before sending.</Text>
          )}
          {people.length === 0 && <Empty>No one suitable this time. Try again later.</Empty>}
          {people.map((p) => {
            const on = picked.has(p.profileUrl);
            return (
              <Pressable
                key={p.profileUrl}
                onPress={() => toggle(p.profileUrl)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={[ui.card, ui.row, { alignItems: 'flex-start', borderColor: on ? colors.accent : colors.cardBorder }]}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: on ? colors.accent : colors.muted,
                    backgroundColor: on ? colors.accent : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 2,
                  }}
                >
                  {on && <Text style={{ color: colors.accentText, fontWeight: '800', fontSize: 13 }}>✓</Text>}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[ui.text, { fontWeight: '600' }]}>{p.name}</Text>
                  {p.headline ? <Text style={ui.text}>{p.headline}</Text> : null}
                  {p.location ? <Text style={ui.muted}>{p.location}</Text> : null}
                  <Text
                    style={{ color: colors.accent, marginTop: 4 }}
                    onPress={() => void Linking.openURL(p.profileUrl)}
                    accessibilityRole="link"
                  >
                    Open profile
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {skipped.length > 0 && (
            <Pressable onPress={() => setShowSkipped(!showSkipped)} style={ui.card}>
              <Text style={ui.text}>
                {showSkipped ? '▾' : '▸'} Left out by the rules: {skipped.length}
              </Text>
              {showSkipped &&
                skipped.map((s, i) => (
                  <Text key={`${s.name}-${i}`} style={ui.muted}>
                    {s.name} - {s.status.replace(/^skipped: /, '')}
                  </Text>
                ))}
            </Pressable>
          )}

          {people.length > 0 && (
            <Button
              title={`Send to ${picked.size} ${picked.size === 1 ? 'person' : 'people'}`}
              onPress={sendNow}
              busy={busy}
              disabled={picked.size === 0 || stale || left === 0}
            />
          )}
        </>
      )}

      {working(send)}
      {failed(send)}
      {send?.status === 'succeeded' && (
        <>
          <Text style={ui.sectionTitle}>Result</Text>
          {(send.output?.results ?? []).map((r, i) => (
            <View key={`${r.profileUrl}-${i}`} style={ui.card}>
              <Text style={[ui.text, { fontWeight: '600' }]}>{r.name || r.profileUrl}</Text>
              <Text style={{ color: r.status === 'sent' ? colors.good : r.status === 'failed' ? colors.bad : colors.warn }}>
                {r.status === 'sent' ? 'Request sent' : r.status}
              </Text>
            </View>
          ))}
          <Button
            kind="secondary"
            title="Done"
            onPress={() => {
              setPreview(undefined);
              setSend(undefined);
              setPicked(new Set());
              remember({});
            }}
          />
        </>
      )}
    </ScrollView>
  );
}
