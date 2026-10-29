/**
 * The one place the dashboard talks to the API. Both server components
 * (initial page load) and client components (the trigger form, the live
 * run view) import from here, so there is exactly one fetch implementation
 * and one set of types to keep in sync with apps/api's routes.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * The owner token (apps/web/.env.local). NEXT_PUBLIC_ means it is built into
 * the page, which is fine for a dashboard that only ever runs on the owner's
 * own machine - never expose this dashboard through a tunnel. The phone app
 * is the remote client.
 */
const API_TOKEN = process.env.NEXT_PUBLIC_PF_API_TOKEN ?? '';

/**
 * TEMPORARY: there is no login/org-switching UI yet (that's better-auth,
 * not wired up). This is the "dev" organization created by
 * packages/db/prisma/seed.ts, which gives it this fixed id. Replace once real
 * auth exists.
 */
export const DEV_ORG_ID = 'dev-org';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Only claim a JSON content-type when a body is actually being sent -
  // Fastify's default parser rejects an empty body arriving with
  // Content-Type: application/json (FST_ERR_CTP_EMPTY_JSON_BODY), which is
  // exactly what a bodyless POST like .../validate was triggering.
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${API_TOKEN}`,
  };
  if (init?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${path} -> ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface AgentSummary {
  key: string;
  platform: string;
  name: string;
  description: string;
  version: number;
  readOnly: boolean;
  quotaCost: Record<string, number>;
}

export interface RunLogEntry {
  id: string;
  ts: string;
  level: string;
  message: string;
  data?: unknown;
}

export interface RunArtifactSummary {
  id: string;
  kind: string;
  storageKey: string;
}

export interface RunDetail {
  id: string;
  agentKey: string;
  status: string;
  trigger: string;
  input: unknown;
  output: unknown;
  processed: number;
  skipped: number;
  failed: number;
  checkpoint: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  attempt: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  logs: RunLogEntry[];
  artifacts: RunArtifactSummary[];
}

export function fetchAgents(): Promise<AgentSummary[]> {
  return apiFetch<AgentSummary[]>('/api/agents');
}

export function fetchRun(id: string): Promise<RunDetail> {
  return apiFetch<RunDetail>(`/api/runs/${id}`);
}

export interface CreateRunPayload {
  organizationId: string;
  agentKey: string;
  identityId: string | null;
  input: Record<string, unknown>;
}

export function createRun(payload: CreateRunPayload): Promise<RunDetail> {
  return apiFetch<RunDetail>('/api/runs', { method: 'POST', body: JSON.stringify(payload) });
}

/** Statuses that mean "stop polling, this Run is finished." */
export const TERMINAL_STATUSES = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'quota_blocked',
]);

export interface IdentitySummary {
  id: string;
  platform: string;
  label: string;
  accountName: string | null;
  status: string;
  statusReason: string | null;
  lastValidatedAt: string | null;
  createdAt: string;
}

export function fetchIdentities(): Promise<IdentitySummary[]> {
  return apiFetch<IdentitySummary[]>(`/api/identities?organizationId=${DEV_ORG_ID}`);
}

export function fetchIdentity(id: string): Promise<IdentitySummary> {
  return apiFetch<IdentitySummary>(`/api/identities/${id}`);
}

export interface IdentityCookieInput {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export interface CreateIdentityPayload {
  platform: 'mock' | 'linkedin';
  label: string;
  cookies: IdentityCookieInput[];
}

export function createIdentity(payload: CreateIdentityPayload): Promise<IdentitySummary> {
  return apiFetch<IdentitySummary>('/api/identities', {
    method: 'POST',
    body: JSON.stringify({ organizationId: DEV_ORG_ID, ...payload }),
  });
}

export function validateIdentity(id: string): Promise<{ queued: boolean }> {
  return apiFetch(`/api/identities/${id}/validate`, { method: 'POST' });
}
