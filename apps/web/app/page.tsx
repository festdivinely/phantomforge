import { fetchAgents } from '@/lib/api';
import { AgentList } from '@/components/AgentList';

export default async function HomePage() {
  const agents = await fetchAgents().catch(() => []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">PhantomForge</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Pick an agent, edit its input, and run it. New here? Read{' '}
        <code className="text-neutral-300">PROJECT_GUIDE.md</code> in the project root.
      </p>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          Registered agents
        </h2>
        <AgentList agents={agents} />
      </section>
    </main>
  );
}
