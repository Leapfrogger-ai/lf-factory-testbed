import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { emailSends } from '../db/schema.ts';
import { appendEvent } from '../domain/events.ts';
import type { CommitRow, PlanRow } from '../domain/plans.ts';
import type { SendEmail } from './send-email.ts';
import { buildEmail, type EmailKind } from './templates.ts';

export type { EmailKind };

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

  const payload = buildEmail(kind, plan, commit, deps.baseUrl);
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
