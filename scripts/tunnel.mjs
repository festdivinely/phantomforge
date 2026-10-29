#!/usr/bin/env node
/**
 * Opens a Cloudflare quick tunnel to the API (never the dashboard: its browser
 * code holds the owner token). No Cloudflare account is needed, but the
 * https://<random>.trycloudflare.com address changes on every start, so it is
 * printed here, saved to .tunnel-url and sent to the owner on Telegram.
 *
 * Needs `cloudflared` on PATH. Stop with Ctrl+C.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const urlPath = resolve(root, '.tunnel-url');

const envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() || undefined;
const port = envValue('API_PORT') ?? '3001';

/** Sends the new address to the owner's Telegram chat, so the phone app can be updated. */
async function tellOwner(url) {
  const bot = envValue('TELEGRAM_BOT_TOKEN');
  const chat = envValue('TELEGRAM_OWNER_CHAT_ID');
  if (!bot || !chat) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: `PhantomForge server address changed.\nCopy it into the phone app (Settings -> Change address):\n\n${url}`,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    console.log(res.ok ? 'Sent the address to Telegram.' : `Telegram refused the message (${res.status}).`);
  } catch {
    console.log('Could not reach Telegram to send the address.');
  }
}

const tunnel = spawn(
  'cloudflared',
  ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

tunnel.on('error', (error) => {
  console.error(
    error.code === 'ENOENT'
      ? 'cloudflared is not installed or not on PATH. See PROJECT_GUIDE.md.'
      : `cloudflared failed to start: ${error.message}`,
  );
  process.exit(1);
});

let announced = false;
let ourUrl;
const watch = (chunk) => {
  const text = chunk.toString();
  if (process.env.TUNNEL_VERBOSE) process.stderr.write(text);
  const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (url && !announced) {
    announced = true;
    ourUrl = url;
    writeFileSync(urlPath, `${url}\n`);
    console.log(`\nAPI is reachable at: ${url}`);
    console.log(`Health check:        ${url}/health`);
    console.log('Every /api request still needs the owner token. Ctrl+C to stop.\n');
    void tellOwner(url);
  }
  if (/ERR|error/i.test(text) && !announced) process.stderr.write(text);
};
tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);

const stop = () => tunnel.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
tunnel.on('exit', (code) => {
  // Only remove our own address: a newer tunnel may already have written its own.
  const current = existsSync(urlPath) ? readFileSync(urlPath, 'utf8').trim() : undefined;
  if (current && current === ourUrl) rmSync(urlPath, { force: true });
  process.exit(code ?? 0);
});
