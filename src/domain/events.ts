import { z } from 'zod';
import type { Tx } from '../db/client.ts';
import { events } from '../db/schema.ts';

const emailKind = z.enum(['manage_link', 'confirmed', 'reminder_24h', 'reminder_morning', 'not_this_time', 'check_in']);

export const eventDataSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('plan.published'), data: z.object({ fromPlanId: z.string().nullable() }) }),
  z.object({
    type: z.literal('commit.added'),
    data: z.object({ change: z.enum(['new', 'repeat', 'rejoined']), isCreator: z.boolean(), activeCount: z.number() }),
  }),
  z.object({ type: z.literal('commit.withdrawn'), data: z.object({ activeCount: z.number() }) }),
  z.object({ type: z.literal('plan.confirmed'), data: z.object({ activeCount: z.number() }) }),
  z.object({
    type: z.literal('plan.called_off'),
    data: z.object({ reason: z.enum(['deadline', 'creator']), wasConfirmed: z.boolean(), activeCount: z.number() }),
  }),
  z.object({ type: z.literal('email.sent'), data: z.object({ kind: emailKind, resendId: z.string() }) }),
  z.object({
    type: z.literal('check_in.answered'),
    data: z.object({ question: z.enum(['happened', 'attended']), answer: z.boolean() }),
  }),
]);

export type EventData = z.infer<typeof eventDataSchema>;

export async function appendEvent(tx: Tx, event: { planId: string; commitId?: string } & EventData): Promise<void> {
  const { planId, commitId, ...rest } = event;
  const { type, data } = eventDataSchema.parse(rest);
  await tx.insert(events).values({ planId, commitId, type, data });
}
