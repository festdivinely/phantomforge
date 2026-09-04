'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchRun, TERMINAL_STATUSES, type RunDetail } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';

/** Live view of one Run: polls until it reaches a terminal status. */
export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const data = await fetchRun(id);
        if (cancelled) return;
        setRun(data);
        setError(null);
        if (!TERMINAL_STATUSES.has(data.status)) {
          timer = setTimeout(poll, 1500);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load run');
        timer = setTimeout(poll, 3000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
        &larr; Agents
      </Link>

      {error && !run && (
        <p className="mt-4 rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm text-red-400">
          {error}
        </p>
      )}

      {!run && !error && <p className="mt-4 text-sm text-neutral-500">Loading run…</p>}

      {run && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{run.agentKey}</h1>
            <StatusBadge status={run.status} />
            {!TERMINAL_STATUSES.has(run.status) && (
              <span className="text-xs text-neutral-500">refreshing…</span>
            )}
          </div>
          <code className="mt-1 block text-xs text-neutral-600">{run.id}</code>

          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
              <div className="text-2xl font-semibold text-emerald-400">{run.processed}</div>
              <div className="text-xs text-neutral-500">processed</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
              <div className="text-2xl font-semibold text-neutral-300">{run.skipped}</div>
              <div className="text-xs text-neutral-500">skipped</div>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
              <div className="text-2xl font-semibold text-red-400">{run.failed}</div>
              <div className="text-xs text-neutral-500">failed</div>
            </div>
          </div>

          {run.errorMessage && (
            <div className="mt-4 rounded-lg border border-red-900 bg-red-950/30 p-4">
              <p className="text-xs uppercase tracking-wider text-red-500">{run.errorCode}</p>
              <p className="mt-1 text-sm text-red-300">{run.errorMessage}</p>
            </div>
          )}

          <section className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
              Logs
            </h2>
            <div className="mt-3 max-h-80 space-y-1 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs">
              {run.logs.length === 0 ? (
                <p className="text-neutral-600">No log entries yet.</p>
              ) : (
                run.logs.map((log) => (
                  <div key={log.id} className="flex gap-2">
                    <span className="shrink-0 text-neutral-600">
                      {new Date(log.ts).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        log.level === 'error'
                          ? 'text-red-400'
                          : log.level === 'warn'
                            ? 'text-amber-400'
                            : 'text-neutral-300'
                      }
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          {run.output != null && (
            <section className="mt-6">
              <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
                Output
              </h2>
              <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-300">
                {JSON.stringify(run.output, null, 2)}
              </pre>
            </section>
          )}
        </>
      )}
    </main>
  );
}
