import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button } from '../../components/ui';
import { fetchImageDataUri } from '../../lib/api';
import { useSession } from '../../lib/connection';
import { useTheme } from '../../lib/theme';
import type { LoginState } from '../../lib/types';

/** How often to ask the server for news; a picture is only downloaded when it changed. */
const REFRESH_MS = 250;
const ZOOMS = [1, 1.5, 2] as const;
const ENDED: LoginState['status'][] = ['done', 'failed', 'cancelled', 'expired'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Live view of LinkedIn's login page in the server's browser. Tap a field on
 * the picture: the typing bar at the bottom takes the keyboard, and what you
 * type goes into that field when you press Send. What you type is never
 * stored or shown anywhere else.
 */
export default function RemoteLoginScreen() {
  const { colors, ui } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, call } = useSession();
  const { width: screenWidth } = useWindowDimensions();
  const [state, setState] = useState<LoginState>();
  const [frame, setFrame] = useState<string>();
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [text, setText] = useState('');
  const [hidden, setHidden] = useState(true);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  /** Where the last tap landed, shown at once so a tap never feels ignored. */
  const [tapMark, setTapMark] = useState<{ x: number; y: number }>();
  const ended = state ? ENDED.includes(state.status) : false;
  const endedRef = useRef(false);
  endedRef.current = ended;
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  // Ask for the state often; fetch the picture only when it changed.
  useEffect(() => {
    let stop = false;
    let shownSeq: number | undefined;
    const loop = async () => {
      while (!stop && !endedRef.current) {
        try {
          const next = await call<LoginState>(`/api/login-sessions/${id}`);
          if (stop) return;
          setState(next);
          if (next.status === 'live' && next.frameSeq !== undefined && next.frameSeq !== shownSeq) {
            const uri = await fetchImageDataUri(session, `/api/login-sessions/${id}/frame`);
            if (uri && !stop) {
              setFrame(uri);
              shownSeq = next.frameSeq;
            }
          }
        } catch {
          // A missed refresh is fine; the next one catches up.
        }
        await sleep(REFRESH_MS);
      }
    };
    void loop();
    return () => {
      stop = true;
    };
  }, [id, call, session]);

  // Leaving this screen (Android back button, closing it) ends the login on
  // the server too, so it doesn't sit open blocking the next one.
  useEffect(
    () => () => {
      if (!endedRef.current) {
        void call(`/api/login-sessions/${id}/cancel`, { method: 'POST', body: {} }).catch(() => undefined);
      }
    },
    [call, id],
  );

  useEffect(() => {
    if (!tapMark) return;
    const t = setTimeout(() => setTapMark(undefined), 700);
    return () => clearTimeout(t);
  }, [tapMark]);

  const send = async (body: object) => {
    try {
      await call(`/api/login-sessions/${id}/input`, { method: 'POST', body });
    } catch (err) {
      Alert.alert('Not sent', err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Opens the keyboard on the typing bar. Android ignores a focus made while
   * the finger is still down, so focus after the touch, and try once more if
   * the keyboard still isn't up.
   */
  const openKeyboard = () => {
    setTimeout(() => inputRef.current?.focus(), 80);
    setTimeout(() => {
      if (!Keyboard.isVisible()) {
        inputRef.current?.blur();
        inputRef.current?.focus();
      }
    }, 450);
  };

  const typeText = async () => {
    if (!text) return;
    setSending(true);
    await send({ kind: 'text', text });
    setText('');
    setSending(false);
  };

  const cancel = async () => {
    await call(`/api/login-sessions/${id}/cancel`, { method: 'POST', body: {} }).catch(() => undefined);
    router.back();
  };

  const pageWidth = state?.width || 412;
  const pageHeight = state?.height || 860;
  const shownWidth = (screenWidth - 32) * zoom;
  const shownHeight = (shownWidth * pageHeight) / pageWidth;

  return (
    <KeyboardAvoidingView style={ui.screen} behavior="padding">
      <Stack.Screen options={{ title: 'Log in to LinkedIn', headerBackVisible: ended }} />
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="always">
        {state && ended ? (
          <View style={[ui.card, { borderColor: state.status === 'done' ? colors.good : colors.bad }]}>
            <Text style={ui.title}>{state.status === 'done' ? 'Account connected' : 'Login stopped'}</Text>
            {state.message ? <Text style={ui.text}>{state.message}</Text> : null}
            <Button title="Back to accounts" onPress={() => router.navigate('/')} />
          </View>
        ) : null}

        {!ended && (
          <>
            <Text style={ui.muted}>
              Tap a box on the page: the typing bar at the bottom opens your keyboard. Type, then press Send. Do the
              same for any code LinkedIn asks for.
            </Text>
            <View style={[ui.row, { justifyContent: 'space-between' }]}>
              <Text style={[ui.muted, { flex: 1 }]} numberOfLines={1}>
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
                    <Text style={{ color: z === zoom ? colors.accentText : colors.text, fontSize: 12, fontWeight: '600' }}>
                      {z}×
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <ScrollView
              horizontal={zoom > 1}
              nestedScrollEnabled
              keyboardShouldPersistTaps="always"
              style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder }}
            >
              <ScrollView
                nestedScrollEnabled
                keyboardShouldPersistTaps="always"
                style={{ maxHeight: zoom > 1 ? 520 : undefined }}
              >
                <Pressable
                  onPress={(e) => {
                    const { locationX, locationY } = e.nativeEvent;
                    setTapMark({ x: locationX, y: locationY });
                    void send({
                      kind: 'tap',
                      x: Math.round((locationX / shownWidth) * pageWidth),
                      y: Math.round((locationY / shownHeight) * pageHeight),
                    });
                    // Tapping the page means "I want to type here".
                    openKeyboard();
                  }}
                >
                  {frame ? (
                    <Image
                      source={{ uri: frame }}
                      style={{ width: shownWidth, height: shownHeight }}
                      resizeMode="stretch"
                      // Android fades every new picture in by default, which flickers a live view.
                      fadeDuration={0}
                    />
                  ) : (
                    <View style={{ width: shownWidth, height: shownHeight, alignItems: 'center', justifyContent: 'center' }}>
                      <ActivityIndicator color={colors.accent} />
                    </View>
                  )}
                  {tapMark ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: tapMark.x - 14,
                        top: tapMark.y - 14,
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        borderWidth: 3,
                        borderColor: colors.accent,
                        backgroundColor: 'transparent',
                      }}
                    />
                  ) : null}
                </Pressable>
              </ScrollView>
            </ScrollView>

            <View style={[ui.row, { flexWrap: 'wrap' }]}>
              <Button small kind="secondary" title="Enter ⏎" onPress={() => void send({ kind: 'key', key: 'Enter' })} />
              <Button small kind="secondary" title="Next box ⇥" onPress={() => void send({ kind: 'key', key: 'Tab' })} />
              <Button small kind="secondary" title="Delete ⌫" onPress={() => void send({ kind: 'key', key: 'Backspace' })} />
              <Button small kind="secondary" title="Scroll ↑" onPress={() => void send({ kind: 'scroll', dy: -400 })} />
              <Button small kind="secondary" title="Scroll ↓" onPress={() => void send({ kind: 'scroll', dy: 400 })} />
            </View>
            <Button kind="danger" title="Cancel login" onPress={() => void cancel()} />
          </>
        )}
      </ScrollView>

      {!ended && (
        // Docked at the bottom like a chat box: always in view, and it sits
        // right above the keyboard when the keyboard is open.
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: typing ? colors.accent : colors.cardBorder,
            backgroundColor: colors.card,
            paddingHorizontal: 12,
            paddingVertical: 10,
            gap: 6,
          }}
        >
          <View style={ui.row}>
            <TextInput
              ref={inputRef}
              style={[ui.input, { flex: 1 }, typing && { borderColor: colors.accent, borderWidth: 2 }]}
              value={text}
              onChangeText={setText}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              placeholder="Type for the box you tapped"
              placeholderTextColor={colors.muted}
              returnKeyType="send"
              submitBehavior="submit"
              onSubmitEditing={() => void typeText()}
              secureTextEntry={hidden}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
            />
            <Button small title="Send" onPress={() => void typeText()} busy={sending} disabled={!text} />
          </View>
          <Pressable onPress={() => setHidden(!hidden)} hitSlop={8}>
            <Text style={[ui.muted, { color: colors.accent }]}>{hidden ? 'Show what I type' : 'Hide what I type'}</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
