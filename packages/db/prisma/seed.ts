/**
 * Seeds the minimum needed to click "Run" in the dashboard on a fresh database:
 * one org, one user, one mock identity, one saved agent config.
 *
 * Safe to re-run - everything is upserted.
 */
import { PrismaClient } from '@prisma/client';
import { env } from '@pf/config';
import { encryptJson } from '@pf/core';

const prisma = new PrismaClient();

/**
 * Fixed, not generated: the dashboard has no org switcher yet and hard-codes
 * this id (apps/web/lib/api.ts DEV_ORG_ID). A random id broke the dashboard on
 * every fresh database, e.g. after moving to another PC.
 */
const DEV_ORG_ID = 'dev-org';

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'dev' },
    update: {},
    create: { id: DEV_ORG_ID, name: 'Dev Workspace', slug: 'dev' },
  });
  if (org.id !== DEV_ORG_ID) {
    console.warn(
      `The "dev" org has id ${org.id}, not ${DEV_ORG_ID}, so the dashboard won't find it. ` +
        'Reset the dev database: pnpm --filter @pf/db run reset',
    );
  }

  const user = await prisma.user.upsert({
    where: { email: 'dev@phantomforge.local' },
    update: {},
    create: { name: 'Dev User', email: 'dev@phantomforge.local', emailVerified: true },
  });

  await prisma.member.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: {},
    create: { userId: user.id, organizationId: org.id, role: 'owner' },
  });

  const existingIdentity = await prisma.identity.findFirst({
    where: { organizationId: org.id, platform: 'mock' },
  });

  // The mock platform needs no real session, but the worker still decrypts
  // every identity it runs on, so store a genuinely encrypted empty cookie
  // list. (Random placeholder bytes failed decryption and broke mock runs.)
  const encrypted = encryptJson([], env.PF_ENCRYPTION_KEY);
  const sealed = {
    encryptedCookies: encrypted.ciphertext,
    encryptionIv: encrypted.iv,
    encryptionTag: encrypted.tag,
  };

  if (existingIdentity) {
    // Repairs mock identities seeded before the fix above.
    await prisma.identity.update({ where: { id: existingIdentity.id }, data: sealed });
  } else {
    await prisma.identity.create({
      data: {
        organizationId: org.id,
        platform: 'mock',
        label: 'Mock Account',
        accountName: 'mock-user',
        ...sealed,
      },
    });
  }

  const existingConfig = await prisma.agentConfig.findFirst({
    where: { organizationId: org.id, agentKey: 'mock.collect-profiles' },
  });

  if (!existingConfig) {
    await prisma.agentConfig.create({
      data: {
        organizationId: org.id,
        agentKey: 'mock.collect-profiles',
        name: 'Collect 10 mock leads',
        input: { query: 'growth marketer', limit: 10 },
      },
    });
  }

  console.log('Seed complete.');
  console.log(`  organization: ${org.slug} (${org.id})`);
  console.log(`  user:         ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
