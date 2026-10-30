import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button } from '../../components/ui';
import { fetchImageDataUri } from '../../lib/api';
import { useSession } from '../../lib/connection';
import { colors, ui } from '../../lib/theme';
import type { LoginState } from '../../lib/types';

const REFRESH_MS = 800;
const ZOOMS = [1, 2, 3] as const;
const ENDED: LoginState['status'][] = ['done', 'failed', 'cancelled', 'expired'];

/**
 * Live view of LinkedIn's login page in the server's browser. Tap the picture
 * to click there, type in the box below, and the server types it into the
 * page. What you type is never stored or shown anywhere else.
 */
export default function RemoteLoginScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, call } = useSession();
  const { width: screenWidth } = useWindowDimensions();
  const [state, setState] = useState<LoginState>();
  const [frame, setFrame] = useState<string>();
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [text, setText] = useState('');
  const [hidden, setHidden] = useState(true);
  const [sending, setSending] = useState(false);
  const ended = state ? ENDED.includes(state.status) : false;
  const endedRef = useRef(false);
  endedRef.current = ended;

  // Poll the state and the picture until the session ends.
  useEffect(() => {
    let stop = false;
    const loop = async () => {
      while (!stop && !endedRef.current) {
        try {
          const next = await call<LoginState>(`/api/login-sessions/${id}`);
          setState(next);
          if (next.status === 'live') {
            const uri = await fetchImageDataUri(session, `/api/login-sessions/${id}/frame`);
            if (uri) setFrame(uri);
          }
        } catch {
          // A missed refresh is fine; the next one catches up.
        }
        await new Promise((r) => setTimeout(r, REFRESH_MS));
      }
    };
    void loop();
    return () => {
      stop = true;
    };
  }, [id, call, session]);

  const send = async (body: object) => {
    try {
      await call(`/api/login-sessions/${id}/input`, { method: 'POST', body });
    } catch (err) {
      Alert.alert('Not sent', err instanceof Error ? err.message : String(err));
    }
  };

  const typeText = async (thenEnter = false) => {
    if (!text) return;
    setSending(true);
    await send({ kind: 'text', text });
    if (thenEnter) await send({ kind: 'key', key: 'Enter' });
    setText('');
    setSending(false);
  };

  const cancel = async () => {
    await call(`/api/login-sessions/${id}/cancel`, { method: 'POST', body: {} }).catch(() => undefined);
    router.back();
  };

  const pageWidth = state?.width || 1440;
  const pageHeight = state?.height || 900;
  const shownWidth = (screenWidth - 32) * zoom;
  const shownHeight = (shownWidth * pageHeight) / pageWidth;

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Log in to LinkedIn', headerBackVisible: ended }} />
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        {!ended && (
          <Text style={ui.muted}>
            This is LinkedIn in the server's browser. Tap a field on the picture, type below, then tap Send. Do the
            same for any code LinkedIn asks for.
          </Text>
        )}

        {state && ended ? (
          <View style={[ui.card, { borderColor: state.status === 'done' ? colors.good : colors.bad }]}>
            <Text style={ui.title}>{state.status === 'done' ? 'Account connected' : 'Login stopped'}</Text>
            {state.message ? <Text style={ui.text}>{state.message}</Text> : null}
            <Button title="Back to accounts" onPress={() => router.navigate('/')} />
          </View>
        ) : null}

        {!ended && (
          <>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={ui.muted} numberOfLines={1}>
                {state?.status === 'live'
                  ? state.page
                  : state?.status === 'saving'
                    ? 'Signed in - saving...'
                    : 'Opening LinkedIn...'}
              </Text>
              <View style={ui.row}>
                {ZOOMS.map((z) => (
                  <Pressable
                    key={z}
                    onPress={() => setZoom(z)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 99,
                      backgroundColor: z === zoom ? colors.accent : colors.input,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{z}×</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <ScrollView horizontal={zoom > 1} nestedScrollEnabled style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder }}>
              <ScrollView nestedScrollEnabled style={{ maxHeight: zoom > 1 ? 360 : undefined }}>
                <Pressable
                  onPress={(e) => {
                    const { locationX, locationY } = e.nativeEvent;
                    void send({
                      kind: 'tap',
                      x: Math.round((locationX / shownWidth) * pageWidth),
                      y: Math.round((locationY / shownHeight) * pageHeight),
                    });
                  }}
                >
                  {frame ? (
                    <Image source={{ uri: frame }} style={{ width: shownWidth, height: shownHeight }} resizeMode="stretch" />
                  ) : (
                    <View style={{ width: shownWidth, height: shownHeight, alignItems: 'center', justifyContent: 'center' }}>
                      <ActivityIndicator color={colors.accent} />
                    </View>
                  )}
                </Pressable>
              </ScrollView>
            </ScrollView>

            <View style={ui.row}>
              <TextInput
                style={[ui.input, { flex: 1 }]}
                value={text}
                onChangeText={setText}
                placeholder="Type here, then Send"
                placeholderTextColor={colors.muted}
                secureTextEntry={hidden}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
              />
              <Button small title="Send" onPress={() => void typeText()} busy={sending} disabled={!text} />
            </View>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <View style={ui.row}>
                <Switch
                  value={hidden}
                  onValueChange={setHidden}
                  trackColor={{ true: colors.accent, false: colors.cardBorder }}
                  accessibilityLabel="Hide what I type"
                />
                <Text style={ui.muted}>Hide what I type</Text>
              </View>
            </View>
            <View style={[ui.row, { flexWrap: 'wrap' }]}>
              <Button small kind="secondary" title="Enter ⏎" onPress={() => void send({ kind: 'key', key: 'Enter' })} />
              <Button small kind="secondary" title="Next field ⇥" onPress={() => void send({ kind: 'key', key: 'Tab' })} />
              <Button small kind="secondary" title="Delete ⌫" onPress={() => void send({ kind: 'key', key: 'Backspace' })} />
              <Button small kind="secondary" title="Scroll ↑" onPress={() => void send({ kind: 'scroll', dy: -400 })} />
              <Button small kind="secondary" title="Scroll ↓" onPress={() => void send({ kind: 'scroll', dy: 400 })} />
            </View>
            <Button kind="danger" title="Cancel login" onPress={() => void cancel()} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
