#!/usr/bin/env node
/**
 * Creates .env from .env.example with real random secrets filled in.
 * Refuses to overwrite an existing .env.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');

if (existsSync(envPath)) {
  console.log('.env already exists - leaving it alone.');
  process.exit(0);
}

const key = () => randomBytes(32).toString('base64');
const contents = readFileSync(resolve(root, '.env.example'), 'utf8')
  .replace(/^PF_ENCRYPTION_KEY=.*$/m, `PF_ENCRYPTION_KEY=${key()}`)
  .replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${key()}`)
  .replace(/^PF_API_TOKEN=.*$/m, `PF_API_TOKEN=${randomBytes(32).toString('base64url')}`);

writeFileSync(envPath, contents);
console.log('Created .env with freshly generated secrets.');
console.log('Back up PF_ENCRYPTION_KEY - losing it makes stored identities unreadable.');
