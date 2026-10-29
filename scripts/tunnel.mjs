#!/usr/bin/env node
/**
 * Opens a Cloudflare quick tunnel to the API (never the dashboard: its browser
 * code holds the owner token). No Cloudflare account is needed, but the
 * https://<random>.trycloudflare.com address changes on every start, so it is
 * printed here and saved to .tunnel-url for the phone app to pick up.
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
const port = envText.match(/^API_PORT=(\d+)/m)?.[1] ?? '3001';

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
const watch = (chunk) => {
  const text = chunk.toString();
  if (process.env.TUNNEL_VERBOSE) process.stderr.write(text);
  const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (url && !announced) {
    announced = true;
    writeFileSync(urlPath, `${url}\n`);
    console.log(`\nAPI is reachable at: ${url}`);
    console.log(`Health check:        ${url}/health`);
    console.log('Every /api request still needs the owner token. Ctrl+C to stop.\n');
  }
  if (/ERR|error/i.test(text) && !announced) process.stderr.write(text);
};
tunnel.stdout.on('data', watch);
tunnel.stderr.on('data', watch);

const stop = () => tunnel.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
tunnel.on('exit', (code) => {
  rmSync(urlPath, { force: true });
  process.exit(code ?? 0);
});
