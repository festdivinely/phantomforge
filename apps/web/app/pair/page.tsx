import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import Link from 'next/link';
import QRCode from 'qrcode';

/** Read on every visit: the tunnel address changes each time it restarts. */
export const dynamic = 'force-dynamic';

/**
 * Pairs the phone app: a QR code holding the API address and the owner
 * token, scanned by the app's camera. The token never leaves this PC and the
 * phone. This dashboard listens on 127.0.0.1 only, so nobody else on the
 * network can open this page.
 */
async function tunnelUrl(): Promise<string | undefined> {
  // `next dev` runs in apps/web; .tunnel-url is written by `pnpm tunnel` at the root.
  const text = await readFile(resolve(process.cwd(), '../../.tunnel-url'), 'utf8').catch(() => '');
  return text.trim() || undefined;
}

/** This PC's Wi-Fi/LAN address, for pairing without a tunnel. */
function lanUrl(): string | undefined {
  const port = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').port || '3001';
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
  // Home routers hand out 192.168.x.x; 172.x is usually WSL/Docker, not the Wi-Fi.
  const ip = addresses.find((a) => a.startsWith('192.168.')) ?? addresses[0];
  return ip ? `http://${ip}:${port}` : undefined;
}

export default async function PairPage({ searchParams }: { searchParams: Promise<{ via?: string }> }) {
  const { via } = await searchParams;
  const token = process.env.NEXT_PUBLIC_PF_API_TOKEN;
  const tunnel = await tunnelUrl();
  const lan = lanUrl();
  const useLan = via === 'lan' || !tunnel;
  const url = useLan ? lan : tunnel;

  const qr =
    token && url
      ? await QRCode.toString(JSON.stringify({ app: 'phantomforge', v: 1, url, token }), {
          type: 'svg',
          margin: 2,
          errorCorrectionLevel: 'M',
        })
      : undefined;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
        &larr; Agents
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Pair the phone app</h1>
      <p className="mt-2 text-sm text-neutral-400">
        In the PhantomForge app, tap <span className="text-neutral-200">Scan pairing QR</span> and point
        the camera here. The code contains the owner token: don&apos;t screenshot or share it.
      </p>

      {!token && (
        <p className="mt-6 text-sm text-red-400">
          NEXT_PUBLIC_PF_API_TOKEN is missing from apps/web/.env.local.
        </p>
      )}

      {qr && (
        <div className="mt-8 flex flex-col items-start gap-4">
          <div
            className="w-72 rounded-xl bg-white p-2"
            // The SVG comes from the qrcode library, built from our own values.
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <p className="text-sm text-neutral-400">
            Server address: <code className="text-neutral-200">{url}</code>
          </p>
        </div>
      )}

      <div className="mt-6 space-y-2 text-sm text-neutral-400">
        {useLan ? (
          <p>
            {tunnel ? 'Showing the Wi-Fi address. ' : 'The tunnel is not running, so this uses the Wi-Fi address. '}
            It only works while the phone is on the same Wi-Fi as this PC. Run{' '}
            <code className="text-neutral-200">pnpm tunnel</code> to reach the server from anywhere.
          </p>
        ) : (
          <p>
            This is the tunnel address, which works from anywhere but changes every time the tunnel
            restarts. When it does, scan again.
          </p>
        )}
        <p className="flex gap-4">
          {tunnel && useLan && (
            <Link href="/pair" className="underline hover:text-neutral-200">
              Use the tunnel address
            </Link>
          )}
          {!useLan && lan && (
            <Link href="/pair?via=lan" className="underline hover:text-neutral-200">
              Use the Wi-Fi address instead
            </Link>
          )}
        </p>
      </div>
    </main>
  );
}
