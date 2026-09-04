import { env } from '@pf/config';
import { prisma } from '@pf/db';
import { decryptJson } from '@pf/core';
import type { IdentitySession, SessionCookie } from '@pf/connectors';

/**
 * Decrypts one identity's stored session cookies.
 *
 * This is the only function in the codebase that ever holds a plaintext
 * cookie in memory. The result is handed straight to Playwright and must
 * never be logged, returned from an API route, or written back to the
 * database - the database only ever stores the encrypted form.
 */
export async function loadIdentitySession(identityId: string): Promise<IdentitySession> {
  const identity = await prisma.identity.findUniqueOrThrow({ where: { id: identityId } });

  const cookies = decryptJson<SessionCookie[]>(
    {
      ciphertext: identity.encryptedCookies,
      iv: identity.encryptionIv,
      tag: identity.encryptionTag,
    },
    env.PF_ENCRYPTION_KEY,
  );

  return {
    identityId: identity.id,
    cookies,
    userAgent: identity.userAgent ?? undefined,
    locale: identity.locale ?? undefined,
    timezoneId: identity.timezoneId ?? undefined,
  };
}
