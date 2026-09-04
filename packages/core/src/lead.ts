import { z } from 'zod';

/**
 * The canonical shape of a person we have discovered.
 *
 * Phantombuster hands you a CSV per run and lets you sort it out. PhantomForge
 * keeps a lead graph instead: every run writes into this shape, deduplicated on
 * `dedupeKey`, so a person met through three different agents is still one person.
 */
export const leadSchema = z.object({
  platform: z.string(),
  /** Stable platform identifier (LinkedIn public identifier, X handle, ...). */
  platformId: z.string().min(1),
  profileUrl: z.string().url().optional(),

  fullName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  headline: z.string().optional(),
  location: z.string().optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  avatarUrl: z.string().url().optional(),

  email: z.string().email().optional(),
  connectionDegree: z.enum(['1st', '2nd', '3rd', 'out_of_network']).optional(),

  /** Anything connector-specific that does not deserve a column. */
  raw: z.record(z.unknown()).default({}),
});

export type Lead = z.infer<typeof leadSchema>;

/**
 * Deterministic identity key. Two records with the same key are the same person.
 * Keep this stable - changing it orphans every previously stored lead.
 */
export function leadDedupeKey(lead: Pick<Lead, 'platform' | 'platformId'>): string {
  return `${lead.platform}:${lead.platformId.trim().toLowerCase()}`;
}
