import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Loading } from '../components/ui';
import { ConnectionProvider, useConnection } from '../lib/connection';
import { colors } from '../lib/theme';

function RootStack() {
  const { session } = useConnection();
  if (session === undefined) return <Loading />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="account/[id]" options={{ title: 'Account' }} />
        <Stack.Screen name="profile/[id]" options={{ title: 'Posting profile' }} />
      </Stack.Protected>
      <Stack.Screen name="connect" options={{ title: 'Connect to PhantomForge' }} />
      <Stack.Screen name="scan" options={{ title: 'Scan pairing QR' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ConnectionProvider>
      <StatusBar style="light" />
      <RootStack />
    </ConnectionProvider>
  );
}
