import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { ApiError } from '../lib/api';
import { useConnection } from '../lib/connection';
import { parsePairingCode } from '../lib/pairing';
import { colors, ui } from '../lib/theme';

/** Scans the pairing QR from the PC dashboard (Pair the phone app) and connects. */
export default function ScanScreen() {
  const { connect } = useConnection();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<{ busy: boolean; message?: string }>({ busy: false });
  // The camera reports the same code many times a second; handle one at a time.
  const handling = useRef(false);

  const onScan = async (data: string) => {
    if (handling.current) return;
    const code = parsePairingCode(data);
    if (!code) {
      setStatus({ busy: false, message: 'That is not a PhantomForge pairing code.' });
      return;
    }
    handling.current = true;
    setStatus({ busy: true, message: 'Connecting...' });
    try {
      await connect(code.url, code.token);
      if (router.canDismiss()) router.dismissAll();
      router.replace('/');
    } catch (err) {
      setStatus({ busy: false, message: err instanceof ApiError ? err.message : String(err) });
      // Let the person point at the code again after reading the message.
      setTimeout(() => (handling.current = false), 2500);
    }
  };

  if (!permission) return <View style={ui.screen} />;

  if (!permission.granted)
    return (
      <View style={[ui.screen, ui.content, { justifyContent: 'center' }]}>
        <Text style={ui.text}>The camera is only used to read the pairing code shown on your PC.</Text>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={() => void requestPermission()} />
        ) : (
          <Button title="Open settings to allow the camera" onPress={() => void Linking.openSettings()} />
        )}
      </View>
    );

  return (
    <View style={ui.screen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={status.busy ? undefined : ({ data }) => void onScan(data)}
      />
      <View style={styles.frame} pointerEvents="none" />
      <View style={styles.panel}>
        {status.busy && <ActivityIndicator color={colors.accent} />}
        <Text style={[ui.text, { textAlign: 'center' }]}>
          {status.message ?? 'On the PC, open the dashboard and click "Pair the phone app". Point the camera at the code.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    alignSelf: 'center',
    top: '22%',
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: colors.accent,
    borderRadius: 16,
  },
  panel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    backgroundColor: 'rgba(11,15,20,0.85)',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
});
