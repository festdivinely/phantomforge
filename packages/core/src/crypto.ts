import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for stored platform session cookies.
 *
 * AES-256-GCM: confidentiality plus an auth tag, so tampering is detected
 * rather than silently decrypted into garbage. The key never leaves the server
 * and is not stored beside the ciphertext.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Buffer, not Uint8Array, is what encryptJson actually produces - but
 * Prisma's generated client returns database Bytes columns typed as plain
 * Uint8Array, and Buffer (a strict superset) can't be assigned FROM a bare
 * Uint8Array even though it's fine the other way round. Typing this as
 * Uint8Array accepts both a fresh Buffer and a value straight out of Prisma;
 * Node's crypto functions accept Uint8Array at runtime regardless.
 */
export interface EncryptedPayload {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
}

function toKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('PF_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)');
  }
  return key;
}

export function encryptJson(value: unknown, base64Key: string): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, toKey(base64Key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function decryptJson<T>(payload: EncryptedPayload, base64Key: string): T {
  const decipher = createDecipheriv(ALGORITHM, toKey(base64Key), payload.iv);
  decipher.setAuthTag(payload.tag);
  const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

/** Generate a fresh key. Used by scripts/generate-secrets. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('base64');
}
