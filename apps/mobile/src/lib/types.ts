/** Shapes returned by the PhantomForge API (apps/api/src/routes). */

export type IdentityStatus = 'active' | 'expired' | 'challenged' | 'restricted' | 'disabled';
export type PostStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'publishing'
  | 'published'
  | 'failed';

export interface KindCount {
  kind: string;
  ok: number;
  failed: number;
}
export type KindCounts = Record<string, KindCount>;

export interface Me {
  role: string;
  organizations: Array<{ id: string; name: string; slug: string }>;
}

export interface AccountOverview {
  id: string;
  platform: string;
  label: string;
  accountName: string | null;
  status: IdentityStatus;
  statusReason: string | null;
  today: KindCounts;
  lastActivity: { occurredAt: string; kind: string; succeeded: boolean; targetName: string | null } | null;
}

export interface Quota {
  action: string;
  used: number;
  limit: number;
  remaining: number;
}

export interface ScheduleSummary {
  id: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  agentConfig: { agentKey: string; name: string };
}

export interface AccountStats {
  identity: { id: string; label: string; status: IdentityStatus; statusReason: string | null };
  today: KindCounts;
  last7Days: KindCounts;
  last30Days: KindCounts;
  allTime: KindCounts;
  daily: Array<{ day: string; kind: string; ok: number; failed: number }>;
  quotaToday: Quota[];
  schedules: ScheduleSummary[];
  pendingPosts: number;
}

export interface Activity {
  id: string;
  kind: string;
  succeeded: boolean;
  targetName: string | null;
  targetUrl: string | null;
  occurredAt: string;
  identityId: string;
  identity: { label: string; platform: string };
}

export interface PostDraft {
  id: string;
  text: string;
  status: PostStatus;
  source: string;
  scheduledFor: string | null;
  decidedAt: string | null;
  publishedAt: string | null;
  postUrl: string | null;
  error: string | null;
  createdAt: string;
  identityId: string;
  identity?: { label: string };
}

export interface PostingProfile {
  about: string;
  audience: string;
  topics: string;
  tone: string;
  avoid: string;
  examples: string;
  autoDraft: boolean;
  /** False when the server has no Claude API key. */
  draftingEnabled?: boolean;
}

export interface DraftJob {
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'prioritized' | 'waiting-children' | 'unknown';
  made?: number;
  error?: string;
}
