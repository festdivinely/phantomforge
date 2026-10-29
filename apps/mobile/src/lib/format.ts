/** Plain-language names for activity kinds (same vocabulary as quotas). */
export const KIND_LABELS: Record<string, string> = {
  connection_accept: 'Accepted',
  connection_request: 'Requests sent',
  connection_withdraw: 'Withdrawn',
  connection_reject: 'Rejected',
  post_create: 'Posts',
  post_engage: 'Engagements',
  message_send: 'Messages',
  profile_view: 'Profile views',
};

/** What one activity row means, as a sentence fragment. */
export const KIND_VERBS: Record<string, string> = {
  connection_accept: 'Accepted invitation from',
  connection_request: 'Sent connection request to',
  connection_withdraw: 'Withdrew invitation to',
  connection_reject: 'Rejected invitation from',
  post_create: 'Published a post',
  post_engage: 'Engaged with a post by',
  message_send: 'Messaged',
  profile_view: 'Viewed profile of',
};

export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind.replaceAll('_', ' ');

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 0) return timeUntil(iso);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function timeUntil(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (seconds <= 60) return 'any moment';
  if (seconds < 3600) return `in ${Math.ceil(seconds / 60)}m`;
  if (seconds < 86_400) return `in ${Math.round(seconds / 3600)}h`;
  return `in ${Math.round(seconds / 86_400)}d`;
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** YYYY-MM-DD in the phone's own time zone. */
export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "0 9,13,17 * * 1-5" -> "9:00, 13:00, 17:00 · Mon-Fri" for the common shapes. */
export function describeCron(cron: string): string {
  const [min, hour, , , dow] = cron.split(/\s+/);
  if (!min || !hour || !/^\d+$/.test(min) || !/^[\d,]+$/.test(hour)) return cron;
  const times = hour
    .split(',')
    .map((h) => `${h}:${min.padStart(2, '0')}`)
    .join(', ');
  const days = dow === '*' ? 'every day' : dow === '1-5' ? 'Mon-Fri' : dow === '0,6' ? 'weekends' : `days ${dow}`;
  return `${times} · ${days}`;
}
