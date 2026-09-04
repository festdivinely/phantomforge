const COLORS: Record<string, string> = {
  queued: 'bg-neutral-800 text-neutral-300',
  running: 'bg-blue-950 text-blue-400',
  succeeded: 'bg-emerald-950 text-emerald-400',
  failed: 'bg-red-950 text-red-400',
  cancelled: 'bg-neutral-800 text-neutral-400',
  timed_out: 'bg-amber-950 text-amber-400',
  quota_blocked: 'bg-purple-950 text-purple-400',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = COLORS[status] ?? 'bg-neutral-800 text-neutral-300';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
