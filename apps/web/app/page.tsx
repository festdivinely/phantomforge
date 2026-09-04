const API_URL = process.env.API_URL ?? 'http://localhost:3001';

interface AgentSummary {
  key: string;
  platform: string;
  name: string;
  description: string;
  readOnly: boolean;
}

async function fetchAgents(): Promise<AgentSummary[]> {
  try {
    const res = await fetch(`${API_URL}/api/agents`, { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as AgentSummary[];
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const agents = await fetchAgents();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">PhantomForge</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Phase 0 &mdash; foundation. Next up: the walking skeleton (see docs/ROADMAP.md).
      </p>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          Registered agents
        </h2>

        {agents.length === 0 ? (
          <p className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 text-sm text-neutral-400">
            No agents loaded. Is the API running on {API_URL}? Start it with{' '}
            <code className="text-neutral-200">pnpm dev</code>.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {agents.map((agent) => (
              <li
                key={agent.key}
                className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{agent.name}</span>
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    {agent.platform}
                  </span>
                  {agent.readOnly && (
                    <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-xs text-emerald-400">
                      read-only
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-neutral-400">{agent.description}</p>
                <code className="mt-2 block text-xs text-neutral-600">{agent.key}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
