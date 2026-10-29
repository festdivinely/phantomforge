import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Button, ErrorBanner, Loading } from '../../components/ui';
import { useSession } from '../../lib/connection';
import { colors, ui } from '../../lib/theme';
import type { PostingProfile } from '../../lib/types';
import { useLoader } from '../../lib/useLoader';

type TextField = Exclude<keyof PostingProfile, 'autoDraft' | 'draftingEnabled'>;

const FIELDS: Array<{ key: TextField; label: string; help: string; placeholder: string; lines: number }> = [
  {
    key: 'about',
    label: 'About you',
    help: 'Your role, experience and what you do. Claude only uses facts written here, never invented ones.',
    placeholder: 'e.g. Mobile developer in Lagos, 4 years with React Native, building trading and automation apps.',
    lines: 4,
  },
  {
    key: 'audience',
    label: 'Who the posts are for',
    help: 'The people you want to connect with.',
    placeholder: 'e.g. Founders, product managers and other developers in fintech.',
    lines: 2,
  },
  {
    key: 'topics',
    label: 'Topics',
    help: 'One per line.',
    placeholder: 'e.g.\nLessons from shipping mobile apps\nAutomation that saves time\nGrowing as a self-taught developer',
    lines: 5,
  },
  {
    key: 'tone',
    label: 'Tone',
    help: 'How the posts should sound.',
    placeholder: 'e.g. Friendly and practical, short sentences, a little humour, no hype.',
    lines: 2,
  },
  {
    key: 'avoid',
    label: 'Never post about',
    help: 'Subjects, words or styles to stay away from.',
    placeholder: 'e.g. Politics, religion, crypto price predictions.',
    lines: 2,
  },
  {
    key: 'examples',
    label: 'Your own past posts (optional)',
    help: 'Paste a few posts you wrote, so drafts sound like you. Put a blank line between posts.',
    placeholder: 'Paste posts here...',
    lines: 6,
  },
];

const EMPTY: PostingProfile = { about: '', audience: '', topics: '', tone: '', avoid: '', examples: '', autoDraft: false };

/** What Claude needs to draft posts in the owner's voice for one account. */
export default function PostingProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call } = useSession();
  const { data, error, reload } = useLoader(() => call<PostingProfile>(`/api/accounts/${id}/posting-profile`));
  const [form, setForm] = useState<PostingProfile>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fill the form once when the profile arrives; don't overwrite typing on refresh.
  useEffect(() => {
    if (data && !dirty) setForm(data);
  }, [data, dirty]);

  const set = <K extends keyof PostingProfile>(key: K, value: PostingProfile[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { draftingEnabled: _, ...body } = form;
      await call(`/api/accounts/${id}/posting-profile`, { method: 'PUT', body });
      setDirty(false);
      if (router.canGoBack()) router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!data && !error) return <Loading />;

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Posting profile' }} />
      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        <ErrorBanner error={error} onRetry={() => void reload()} />
        {data?.draftingEnabled === false && (
          <View style={[ui.card, { borderColor: colors.warn }]}>
            <Text style={ui.text}>
              Claude drafting is off on the server: ANTHROPIC_API_KEY is empty in its .env. You can still fill this in now.
            </Text>
          </View>
        )}
        <Text style={ui.muted}>
          Claude writes LinkedIn drafts from this. Every draft waits for your approval; nothing is posted without you.
        </Text>

        {FIELDS.map((f) => (
          <View key={f.key} style={{ gap: 6 }}>
            <Text style={ui.sectionTitle}>{f.label}</Text>
            <Text style={ui.muted}>{f.help}</Text>
            <TextInput
              style={[ui.input, { minHeight: 22 * f.lines + 20, textAlignVertical: 'top' }]}
              value={form[f.key]}
              onChangeText={(v) => set(f.key, v)}
              placeholder={f.placeholder}
              placeholderTextColor={colors.muted}
              multiline
            />
          </View>
        ))}

        <View style={[ui.card, ui.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={ui.text}>Draft every morning</Text>
            <Text style={ui.muted}>Keeps a few fresh Claude drafts waiting for you each day.</Text>
          </View>
          <Switch
            value={form.autoDraft}
            onValueChange={(v) => set('autoDraft', v)}
            trackColor={{ true: colors.accent, false: colors.cardBorder }}
            accessibilityLabel="Draft every morning"
          />
        </View>

        <Button title="Save profile" onPress={() => void save()} busy={saving} disabled={!dirty} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
