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
 * Deliberately Uint8Array<ArrayBuffer>, not Buffer. Prisma's generated
 * client both accepts and returns its Bytes columns as exactly this type,
 * and Buffer's own declared type (ArrayBufferLike-backed) is subtly too
 * loose to satisfy it in either direction. encryptJson() re-wraps its
 * output to match; decryptJson() accepts values read straight back out of
 * Prisma with no conversion needed.
 */
export interface EncryptedPayload {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  tag: Uint8Array<ArrayBuffer>;
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
  const tag = cipher.getAuthTag();

  // Buffer's declared type is looser (ArrayBufferLike) than the specific
  // Uint8Array<ArrayBuffer> Prisma's generated client expects for its Bytes
  // columns. Re-wrapping allocates a genuinely fresh ArrayBuffer-backed
  // Uint8Array that satisfies both that and decryptJson's own reads below.
  return {
    ciphertext: new Uint8Array(ciphertext) as Uint8Array<ArrayBuffer>,
    iv: new Uint8Array(iv) as Uint8Array<ArrayBuffer>,
    tag: new Uint8Array(tag) as Uint8Array<ArrayBuffer>,
  };
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
