/**
 * Seeds the minimum needed to click "Run" in the dashboard on a fresh database:
 * one org, one user, one mock identity, one saved agent config.
 *
 * Safe to re-run - everything is upserted.
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'dev' },
    update: {},
    create: { name: 'Dev Workspace', slug: 'dev' },
  });

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

  if (!existingIdentity) {
    // The mock platform needs no real session, so placeholder bytes are fine.
    await prisma.identity.create({
      data: {
        organizationId: org.id,
        platform: 'mock',
        label: 'Mock Account',
        accountName: 'mock-user',
        encryptedCookies: randomBytes(16),
        encryptionIv: randomBytes(12),
        encryptionTag: randomBytes(16),
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
