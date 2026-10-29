'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createRun,
  DEV_ORG_ID,
  fetchIdentities,
  type AgentSummary,
  type IdentitySummary,
} from '@/lib/api';

/**
 * Sensible starting input per known agent, so a non-technical user has
 * something valid to look at instead of a blank "{}" and no idea what
 * fields are expected. This is a stand-in for a real Zod-schema-driven
 * form (see docs/ROADMAP.md) - fine for Phase 1, worth replacing later.
 */
const DEFAULT_INPUT: Record<string, unknown> = {
  'mock.collect-profiles': { query: 'growth marketer', limit: 5 },
  'mock.send-connection': { profileIds: ['test-1', 'test-2'], failureRate: 0 },
  'mock.accept-invitations': { pending: 8, max: 5, failureRate: 0 },
  'linkedin.accept-invitations': { max: 10 },
  'linkedin.send-connection': { profileUrls: ['https://www.linkedin.com/in/example'] },
};

/** Real platforms act through a saved account; the mock works without one. */
function needsIdentity(agent: AgentSummary): boolean {
  return agent.platform !== 'mock';
}

function defaultInputFor(key: string): string {
  return JSON.stringify(DEFAULT_INPUT[key] ?? {}, null, 2);
}

export function AgentList({ agents }: { agents: AgentSummary[] }) {
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [identities, setIdentities] = useState<IdentitySummary[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchIdentities()
      .then(setIdentities)
      .catch(() => setIdentities([]));
  }, []);

  if (agents.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 text-sm text-neutral-400">
        No agents loaded. Is the API running? Start the full stack with{' '}
        <code className="text-neutral-200">pnpm dev</code>.
      </p>
    );
  }

  async function handleRun(agent: AgentSummary) {
    const agentKey = agent.key;
    setSubmitting(true);
    setFormError(null);
    try {
      const identityId = chosen[agentKey] || null;
      if (!identityId && needsIdentity(agent)) {
        throw new Error(`Choose which ${agent.platform} account this run should use.`);
      }
      const raw = inputs[agentKey] ?? defaultInputFor(agentKey);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new Error('That input is not valid JSON - check for a missing quote or comma.');
      }
      const run = await createRun({
        organizationId: DEV_ORG_ID,
        agentKey,
        identityId,
        input: parsed,
      });
      router.push(`/runs/${run.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to start run');
      setSubmitting(false);
    }
  }

  return (
    <ul className="mt-4 space-y-3">
      {agents.map((agent) => {
        const isOpen = openKey === agent.key;
        return (
          <li key={agent.key} className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
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
              </div>
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setOpenKey(isOpen ? null : agent.key);
                }}
                className="shrink-0 rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
              >
                {isOpen ? 'Close' : 'Run'}
              </button>
            </div>

            {isOpen && (
              <div className="mt-4 border-t border-neutral-800 pt-4">
                <label className="text-xs uppercase tracking-wider text-neutral-500">
                  Account
                </label>
                <select
                  className="mt-2 mb-4 w-full rounded-md border border-neutral-700 bg-neutral-950 p-2 text-sm text-neutral-200"
                  value={chosen[agent.key] ?? ''}
                  onChange={(e) => setChosen((prev) => ({ ...prev, [agent.key]: e.target.value }))}
                >
                  <option value="">
                    {needsIdentity(agent) ? `Choose a ${agent.platform} account…` : 'None (mock works without one)'}
                  </option>
                  {identities
                    .filter((i) => i.platform === agent.platform)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label} - {i.status}
                        {i.status !== 'active' && i.statusReason ? ` (${i.statusReason})` : ''}
                      </option>
                    ))}
                </select>
                {needsIdentity(agent) &&
                  identities.filter((i) => i.platform === agent.platform).length === 0 && (
                    <p className="-mt-2 mb-4 text-sm text-amber-400">
                      No {agent.platform} account saved yet - add one on the Identities page.
                    </p>
                  )}
                <label className="text-xs uppercase tracking-wider text-neutral-500">
                  Input (JSON)
                </label>
                <textarea
                  className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 p-3 font-mono text-xs text-neutral-200"
                  rows={6}
                  spellCheck={false}
                  value={inputs[agent.key] ?? defaultInputFor(agent.key)}
                  onChange={(e) =>
                    setInputs((prev) => ({ ...prev, [agent.key]: e.target.value }))
                  }
                />
                {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleRun(agent)}
                  className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {submitting ? 'Starting…' : 'Start run'}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
