import { prisma } from '@pf/db';

/**
 * Moves the PostDraft a run was publishing (if any) to its final state.
 * Agents never touch the database, so the worker does this after the run.
 */
export async function settlePost(
  runId: string,
  result: { ok: true; postUrl?: string } | { ok: false; error: string },
): Promise<void> {
  const post = await prisma.postDraft.findUnique({ where: { runId }, select: { id: true } });
  if (!post) return;

  await prisma.postDraft.update({
    where: { id: post.id },
    data: result.ok
      ? { status: 'published', publishedAt: new Date(), postUrl: result.postUrl ?? null, error: null }
      : { status: 'failed', error: result.error },
  });
}

/** The post URL an agent reported in its results, if it reported one. */
export function postUrlFrom(results: unknown[]): string | undefined {
  const first = results[0] as { postUrl?: unknown } | undefined;
  return typeof first?.postUrl === 'string' ? first.postUrl : undefined;
}
