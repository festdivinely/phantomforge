import type { Page } from 'playwright';
import type { ActivityRecord, AgentContext } from '@pf/connectors';
import type { Checkpoint, LogLevel, QuotaAction, RunArtifact } from '@pf/core';
import { leadDedupeKey, leadSchema } from '@pf/core';
import { prisma } from '@pf/db';
import { consumeQuota, pace } from '@pf/quota';
import { putObject } from '@pf/storage';

/**
 * Builds the sandbox an agent runs inside.
 *
 * Everything an agent is permitted to do is wired here, which means the safety
 * rules (quota, pacing, checkpointing, audit) are enforced by the platform
 * rather than trusted to each agent author.
 */
export function createAgentContext(params: {
  runId: string;
  organizationId: string;
  identityId: string;
  page: Page;
  signal: AbortSignal;
}): AgentContext {
  const { runId, organizationId, identityId, page, signal } = params;

  return {
    runId,
    identityId,
    page,
    signal,

    log(level: LogLevel, message: string, data?: Record<string, unknown>) {
      console.log(`[${level}] ${runId} ${message}`);
      void prisma.runLog
        .create({ data: { runId, level, message, data: data as object } })
        .catch(() => undefined);
    },

    async consumeQuota(action: QuotaAction, amount = 1) {
      await consumeQuota(organizationId, identityId, action, amount);
    },

    async pace() {
      await pace(signal);
    },

    async saveCheckpoint(checkpoint: Omit<Checkpoint, 'updatedAt'>) {
      const full: Checkpoint = { ...checkpoint, updatedAt: new Date().toISOString() };
      await prisma.run.update({
        where: { id: runId },
        data: { checkpoint: full as object, processed: checkpoint.processed },
      });
    },

    async loadCheckpoint(): Promise<Checkpoint | null> {
      const run = await prisma.run.findUnique({ where: { id: runId }, select: { checkpoint: true } });
      return (run?.checkpoint as Checkpoint | null) ?? null;
    },

    async emitLead(raw: unknown) {
      const lead = leadSchema.parse(raw);
      const dedupeKey = leadDedupeKey(lead);

      const stored = await prisma.lead.upsert({
        where: { organizationId_dedupeKey: { organizationId, dedupeKey } },
        update: {
          fullName: lead.fullName,
          headline: lead.headline,
          company: lead.company,
          jobTitle: lead.jobTitle,
          location: lead.location,
          profileUrl: lead.profileUrl,
          raw: lead.raw as object,
        },
        create: {
          organizationId,
          dedupeKey,
          platform: lead.platform as 'mock' | 'linkedin',
          platformId: lead.platformId,
          profileUrl: lead.profileUrl,
          fullName: lead.fullName,
          firstName: lead.firstName,
          lastName: lead.lastName,
          headline: lead.headline,
          location: lead.location,
          company: lead.company,
          jobTitle: lead.jobTitle,
          avatarUrl: lead.avatarUrl,
          email: lead.email,
          connectionDegree: lead.connectionDegree,
          raw: lead.raw as object,
        },
      });

      await prisma.leadInteraction.create({
        data: { leadId: stored.id, runId, action: 'discovered', succeeded: true },
      });
    },

    async recordActivity(activity: ActivityRecord) {
      await prisma.activity.create({
        data: {
          organizationId,
          identityId,
          runId,
          kind: activity.kind,
          succeeded: activity.ok,
          targetName: activity.targetName,
          targetUrl: activity.targetUrl,
          detail: activity.detail as object | undefined,
        },
      });
    },

    async captureArtifact(kind: RunArtifact['kind'], note?: string): Promise<RunArtifact> {
      const isShot = kind === 'screenshot';
      const contentType = isShot ? 'image/png' : 'text/html';
      const key = `runs/${runId}/${kind}-${Date.now()}.${isShot ? 'png' : 'html'}`;
      // A failed capture must never turn a clean stop into a crash.
      try {
        const body = isShot
          ? await page.screenshot({ fullPage: false, timeout: 10_000 })
          : Buffer.from(await page.content(), 'utf8');
        await putObject(key, new Uint8Array(body), contentType);
      } catch (error) {
        console.error(`[artifact] ${runId} could not save ${kind}:`, error instanceof Error ? error.message : error);
      }
      const artifact: RunArtifact = { kind, key, contentType, capturedAt: new Date().toISOString(), note };
      await prisma.runArtifact.create({ data: { runId, kind, storageKey: key, contentType, note } });
      return artifact;
    },
  };
}
