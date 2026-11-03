import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { emailSends } from '../db/schema.ts';
import { appendEvent } from '../domain/events.ts';
import type { CommitRow, PlanRow } from '../domain/plans.ts';
import { formatDay } from '../domain/time.ts';
import type { EmailPayload, SendEmail } from './send-email.ts';

export type EmailKind = typeof emailSends.$inferSelect['kind'];

function buildPayload(kind: EmailKind, plan: PlanRow, commit: CommitRow, baseUrl: string): EmailPayload {
  if (kind !== 'manage_link') throw new Error(`No email template for ${kind}`);
  const format = plan.format.charAt(0).toUpperCase() + plan.format.slice(1);
  const day = formatDay(plan.gatheringAt.toTemporalInstant());
  const text = [
    `${format} at ${plan.venue}, ${day}`,
    '',
    `Here's your private link to see who's in or call it off. Don't share it.`,
    '',
    `${baseUrl}/m/${plan.manageToken}`,
    '',
    'Paste this one in your chat:',
    `${baseUrl}/p/${plan.publicToken}`,
    '',
  ].join('\n');
  return {
    to: commit.email,
    subject: `Your plan: ${format} at ${plan.venue}, ${day}`,
    text,
    tags: [{ name: 'kind', value: kind }],
  };
}

/** Sends the email for (commit, kind) at most once; a failed send leaves the ledger row unsent for a retry. */
export async function sendOnce(
  deps: { db: Db; sendEmail: SendEmail; baseUrl: string },
  kind: EmailKind,
  plan: PlanRow,
  commit: CommitRow,
): Promise<void> {
  const { db } = deps;
  await db.insert(emailSends).values({ commitId: commit.id, kind }).onConflictDoNothing();
  const [row] = await db
    .select({ sentAt: emailSends.sentAt })
    .from(emailSends)
    .where(and(eq(emailSends.commitId, commit.id), eq(emailSends.kind, kind)));
  if (row?.sentAt) return;

  const payload = buildPayload(kind, plan, commit, deps.baseUrl);
  const { id: resendId } = await deps.sendEmail(payload, `${kind}/${plan.id}/${commit.id}`);

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(emailSends)
      .set({ resendId, sentAt: sql`now()` })
      .where(and(eq(emailSends.commitId, commit.id), eq(emailSends.kind, kind), isNull(emailSends.sentAt)))
      .returning({ commitId: emailSends.commitId });
    if (updated.length > 0) {
      await appendEvent(tx, { planId: plan.id, commitId: commit.id, type: 'email.sent', data: { kind, resendId } });
    }
  });
}
