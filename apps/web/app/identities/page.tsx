import Link from 'next/link';
import { fetchIdentities } from '@/lib/api';
import { IdentityManager } from '@/components/IdentityManager';

export default async function IdentitiesPage() {
  const identities = await fetchIdentities().catch(() => []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
        &larr; Agents
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Identities</h1>
      <p className="mt-2 text-sm text-neutral-400">
        A saved, logged-in account an agent runs as. Session cookies are encrypted before
        they touch the database. Use a throwaway LinkedIn account here, never your real one.
      </p>
      <IdentityManager initialIdentities={identities} />
    </main>
  );
}
