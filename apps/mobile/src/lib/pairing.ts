/**
 * The pairing QR shown on the PC dashboard (apps/web/app/pair) holds
 * `{"app":"phantomforge","v":1,"url":"...","token":"..."}`.
 * Returns undefined for any other QR code.
 */
export function parsePairingCode(data: string): { url: string; token: string } | undefined {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object') return undefined;
    const { app, v, url, token } = value as Record<string, unknown>;
    if (app !== 'phantomforge' || v !== 1) return undefined;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return undefined;
    if (typeof token !== 'string' || token.length < 32) return undefined;
    return { url, token };
  } catch {
    return undefined;
  }
}
