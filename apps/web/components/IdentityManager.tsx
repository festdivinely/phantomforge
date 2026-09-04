'use client';

import { useState } from 'react';
import {
  createIdentity,
  fetchIdentity,
  validateIdentity,
  type IdentitySummary,
} from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';

export function IdentityManager({ initialIdentities }: { initialIdentities: IdentitySummary[] }) {
  const [identities, setIdentities] = useState(initialIdentities);
  const [platform, setPlatform] = useState<'linkedin' | 'mock'>('mock');
  const [label, setLabel] = useState('');
  const [cookieValue, setCookieValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      if (!label.trim()) throw new Error('Give this identity a label, e.g. "Test account".');
      if (platform === 'linkedin' && !cookieValue.trim()) {
        throw new Error('Paste the li_at cookie value first - see the instructions below.');
      }

      const cookies =
        platform === 'linkedin'
          ? [{ name: 'li_at', value: cookieValue.trim(), domain: '.linkedin.com', path: '/' }]
          : [{ name: 'mock_session', value: 'test-session', domain: 'mock.local', path: '/' }];

      const identity = await createIdentity({ platform, label: label.trim(), cookies });
      setIdentities((prev) => [identity, ...prev]);
      setLabel('');
      setCookieValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create identity');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleValidate(id: string) {
    setValidatingId(id);
    try {
      await validateIdentity(id);
      // Simple bounded poll: the worker opens a real browser for this, which
      // can take a few seconds - give up gracefully rather than forever.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const updated = await fetchIdentity(id);
        setIdentities((prev) => prev.map((it) => (it.id === id ? updated : it)));
        if (updated.lastValidatedAt) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed to start');
    } finally {
      setValidatingId(null);
    }
  }

  return (
    <>
      <section className="mt-8 rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          Add identity
        </h2>

        <div className="mt-3 flex gap-2">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as 'linkedin' | 'mock')}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          >
            <option value="linkedin">LinkedIn</option>
            <option value="mock">Mock (for testing)</option>
          </select>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label, e.g. Test account"
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
        </div>

        {platform === 'linkedin' && (
          <div className="mt-3">
            <label className="text-xs uppercase tracking-wider text-neutral-500">
              li_at cookie value
            </label>
            <input
              type="password"
              value={cookieValue}
              onChange={(e) => setCookieValue(e.target.value)}
              placeholder="Paste the li_at cookie value here"
              className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs"
            />
            <p className="mt-2 text-xs leading-relaxed text-neutral-500">
              While logged into LinkedIn in Chrome: press F12 &rarr; Application tab &rarr;
              Cookies &rarr; https://www.linkedin.com &rarr; find <code className="text-neutral-400">li_at</code> &rarr;
              copy its Value. Treat it like a password - it logs in as that account. Use a
              throwaway LinkedIn account here, not your real one.
            </p>
          </div>
        )}

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <button
          type="button"
          disabled={submitting}
          onClick={handleCreate}
          className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save identity'}
        </button>
      </section>

      <ul className="mt-6 space-y-3">
        {identities.length === 0 && <p className="text-sm text-neutral-500">No identities yet.</p>}
        {identities.map((identity) => (
          <li key={identity.id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{identity.label}</span>
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    {identity.platform}
                  </span>
                  <StatusBadge status={identity.status} />
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {identity.lastValidatedAt
                    ? `Last checked ${new Date(identity.lastValidatedAt).toLocaleString()}`
                    : 'Never checked'}
                  {identity.statusReason ? ` — ${identity.statusReason}` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={validatingId === identity.id}
                onClick={() => handleValidate(identity.id)}
                className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-50"
              >
                {validatingId === identity.id ? 'Checking…' : 'Validate'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
