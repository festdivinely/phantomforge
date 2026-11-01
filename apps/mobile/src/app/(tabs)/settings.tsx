import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Button } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useConnection, useSession } from '../../lib/connection';
import { useTheme, type ThemeMode } from '../../lib/theme';

const THEME_CHOICES: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: 'Match phone' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const { colors, ui, mode, setMode } = useTheme();
  const { session, call } = useSession();
  const { disconnect } = useConnection();
  const [check, setCheck] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);

  const test = async () => {
    setBusy(true);
    const started = Date.now();
    try {
      await call('/api/me');
      setCheck({ ok: true, text: `Connected (${Date.now() - started} ms)` });
    } catch (err) {
      setCheck({ ok: false, text: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const confirmDisconnect = () =>
    Alert.alert('Disconnect this phone?', 'The saved address and token are removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect() },
    ]);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content}>
      <View style={ui.card}>
        <Text style={ui.sectionTitle}>Appearance</Text>
        <View style={[ui.row, { flexWrap: 'wrap' }]}>
          {THEME_CHOICES.map((choice) => {
            const on = choice.mode === mode;
            return (
              <Pressable
                key={choice.mode}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setMode(choice.mode)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 99,
                  backgroundColor: on ? colors.accent : colors.input,
                }}
              >
                <Text style={{ color: on ? colors.accentText : colors.text, fontWeight: '600' }}>{choice.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={ui.muted}>"Match phone" follows your phone's light or dark setting.</Text>
      </View>
      <View style={ui.card}>
        <Text style={ui.sectionTitle}>Server</Text>
        <Text style={ui.text} selectable>
          {session.url}
        </Text>
        <Text style={ui.muted}>Workspace: {session.orgName}</Text>
        {check ? <Text style={{ color: check.ok ? colors.good : colors.bad }}>{check.text}</Text> : null}
        <View style={[ui.row, { flexWrap: 'wrap' }]}>
          <Button small title="Check connection" onPress={() => void test()} busy={busy} />
          <Button small kind="secondary" title="Change address" onPress={() => router.push('/connect')} />
        </View>
      </View>
      <Text style={ui.muted}>
        The quick tunnel's address changes every time it restarts on the PC. When that happens, the new address is sent
        to you on Telegram: copy it and use "Change address".
      </Text>
      <Button kind="danger" title="Disconnect this phone" onPress={confirmDisconnect} />
    </ScrollView>
  );
}
