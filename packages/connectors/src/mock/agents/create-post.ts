import { z } from 'zod';
import { defineAgent } from '../../base/agent.js';

const inputSchema = z.object({
  /** The approved PostDraft this run publishes; the worker marks it published. */
  postId: z.string().min(1),
  text: z.string().min(1).max(3000),
  /** Make the mock platform refuse the post, to test the failure path. */
  fail: z.boolean().default(false),
});

/**
 * Publishes one approved post on the fake platform. Never queued by hand in
 * normal use: the scheduler queues it when a PostDraft is approved and due.
 */
export const createPostAgent = defineAgent({
  key: 'mock.create-post',
  platform: 'mock',
  name: 'Publish Post (Mock)',
  description: 'Publishes one owner-approved post on the fake platform.',
  version: 1,
  inputSchema,
  quotaCost: { post_create: 1 },
  readOnly: false,

  async execute(ctx, input) {
    await ctx.consumeQuota('post_create');
    await ctx.pace();

    const ok = !input.fail;
    type Result = { postId: string; ok: boolean; postUrl?: string };
    const postUrl = ok ? `https://mock.local/posts/${input.postId}` : undefined;
    await ctx.recordActivity({
      kind: 'post_create',
      ok,
      targetUrl: postUrl,
      detail: { postId: input.postId, preview: input.text.slice(0, 80) },
    });

    if (!ok) {
      ctx.log('warn', 'Mock platform refused the post');
      return { processed: 0, skipped: 0, failed: 1, results: [{ postId: input.postId, ok } as Result] };
    }
    ctx.log('info', `Published post ${input.postId}`);
    return { processed: 1, skipped: 0, failed: 0, results: [{ postId: input.postId, ok, postUrl } as Result] };
  },
});
