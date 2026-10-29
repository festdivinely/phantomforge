import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, Text, View } from 'react-native';
import { Empty, ErrorBanner, Loading } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useSession } from '../../lib/connection';
import { KIND_VERBS, timeAgo } from '../../lib/format';
import { colors, ui } from '../../lib/theme';
import type { Activity } from '../../lib/types';

const PAGE = 40;
const POLL_MS = 10_000;

/** Live feed: newest first; new items appear on their own every few seconds. */
export default function ActivityScreen() {
  const { session, call } = useSession();
  const [items, setItems] = useState<Activity[]>();
  const [error, setError] = useState<ApiError>();
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const itemsRef = useRef<Activity[] | undefined>(undefined);
  itemsRef.current = items;

  const base = `/api/activity?organizationId=${session.orgId}&limit=${PAGE}`;

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn();
      setError(undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 500));
    }
  }, []);

  const loadFirst = useCallback(
    () =>
      guard(async () => {
        const page = await call<Activity[]>(base);
        setItems(page);
        setAtEnd(page.length < PAGE);
      }),
    [base, call, guard],
  );

  const pollNew = useCallback(
    () =>
      guard(async () => {
        const newest = itemsRef.current?.[0]?.occurredAt;
        if (!newest) return loadFirst();
        const fresh = await call<Activity[]>(`${base}&after=${encodeURIComponent(newest)}`);
        if (fresh.length) setItems((prev) => [...fresh, ...(prev ?? [])]);
      }),
    [base, call, guard, loadFirst],
  );

  const loadMore = async () => {
    const oldest = items?.[items.length - 1]?.occurredAt;
    if (!oldest || atEnd || loadingMore) return;
    setLoadingMore(true);
    await guard(async () => {
      const page = await call<Activity[]>(`${base}&before=${encodeURIComponent(oldest)}`);
      setItems((prev) => [...(prev ?? []), ...page]);
      setAtEnd(page.length < PAGE);
    });
    setLoadingMore(false);
  };

  useFocusEffect(
    useCallback(() => {
      void (itemsRef.current ? pollNew() : loadFirst());
      const timer = setInterval(() => void pollNew(), POLL_MS);
      return () => clearInterval(timer);
    }, [loadFirst, pollNew]),
  );

  if (!items && !error) return <Loading />;

  return (
    <FlatList
      style={ui.screen}
      contentContainerStyle={ui.content}
      data={items ?? []}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={<ErrorBanner error={error} onRetry={() => void loadFirst()} />}
      ListEmptyComponent={items ? <Empty>Nothing has happened yet. Runs and schedules show up here.</Empty> : undefined}
      ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} /> : undefined}
      onEndReached={() => void loadMore()}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          onRefresh={async () => {
            setRefreshing(true);
            await loadFirst();
            setRefreshing(false);
          }}
        />
      }
      renderItem={({ item }) => (
        <Pressable
          disabled={!item.targetUrl}
          onPress={() => item.targetUrl && void Linking.openURL(item.targetUrl)}
          style={[ui.card, { flexDirection: 'row', gap: 10 }]}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              marginTop: 6,
              backgroundColor: item.succeeded ? colors.good : colors.bad,
            }}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={ui.text}>
              {KIND_VERBS[item.kind] ?? item.kind}
              {item.targetName ? <Text style={{ fontWeight: '600' }}> {item.targetName}</Text> : null}
              {item.succeeded ? '' : ' - failed'}
            </Text>
            <Text style={ui.muted}>
              {item.identity.label} · {timeAgo(item.occurredAt)}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}
