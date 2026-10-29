import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Button } from '../components/ui';
import { ApiError } from '../lib/api';
import { useConnection } from '../lib/connection';
import { colors, ui } from '../lib/theme';

/**
 * First screen, and where to come back when the tunnel address changes.
 * The token is kept when only the address is updated.
 */
export default function ConnectScreen() {
  const { connect, saved, session } = useConnection();
  const [url, setUrl] = useState(saved?.url ?? '');
  const [token, setToken] = useState(saved?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const paste = async (set: (v: string) => void) => set((await Clipboard.getStringAsync()).trim());

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await connect(url, token);
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <Text style={ui.text}>
          Connect this phone to PhantomForge on your PC. On the PC, run <Text style={{ fontWeight: '700' }}>pnpm tunnel</Text>:
          the new address appears there and is also sent to you on Telegram.
        </Text>

        <Text style={ui.sectionTitle}>Server address</Text>
        <TextInput
          style={ui.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://something.trycloudflare.com"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <View style={ui.row}>
          <Button small kind="secondary" title="Paste address" onPress={() => void paste(setUrl)} />
        </View>

        <Text style={ui.sectionTitle}>Owner token</Text>
        <TextInput
          style={ui.input}
          value={token}
          onChangeText={setToken}
          placeholder="PF_API_TOKEN from the PC's .env"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <View style={ui.row}>
          <Button small kind="secondary" title="Paste token" onPress={() => void paste(setToken)} />
        </View>
        <Text style={ui.muted}>The token is stored in the phone's secure storage and only sent to your server.</Text>

        {error ? <Text style={{ color: colors.bad, fontSize: 14 }}>{error}</Text> : null}
        <Button title={session ? 'Save and reconnect' : 'Connect'} onPress={() => void submit()} busy={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
