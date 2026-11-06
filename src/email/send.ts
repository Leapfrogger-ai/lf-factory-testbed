import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { emailSends } from '../db/schema.ts';
import { appendEvent } from '../domain/events.ts';
import type { CommitRow, PlanRow } from '../domain/plans.ts';
import type { SendEmail } from './send-email.ts';
import { buildEmail, type EmailKind } from './templates.ts';

export type { EmailKind };

/** Resend's error name, which createSendEmail puts in its failure message. */
const IDEMPOTENT_REPLAY_ERROR = 'invalid_idempotent_request';
/** Stored as the resend id when Resend gave none because the key was already used. */
const IDEMPOTENT_REPLAY_ID = 'idempotent-replay';

/** Sends the email for (commit, kind) at most once; a failed send leaves the ledger row unsent for a retry. */
export async function sendOnce(
  deps: { db: Db; sendEmail: SendEmail; baseUrl: string },
  kind: EmailKind,
  plan: PlanRow,
  commit: CommitRow,
  activeCommits: CommitRow[] = [],
): Promise<void> {
  const { db } = deps;
  await db.insert(emailSends).values({ commitId: commit.id, kind }).onConflictDoNothing();
  const [row] = await db
    .select({ sentAt: emailSends.sentAt })
    .from(emailSends)
    .where(and(eq(emailSends.commitId, commit.id), eq(emailSends.kind, kind)));
  if (row?.sentAt) return;

  const payload = buildEmail(kind, plan, commit, deps.baseUrl, activeCommits);
  let resendId: string;
  try {
    ({ id: resendId } = await deps.sendEmail(payload, `${kind}/${plan.id}/${commit.id}`));
  } catch (error) {
    // Resend rejects a reused key whose body changed: the first attempt did reach Resend (a retry after a
    // post-send failure, with a changed "are in" list), so the email is already sent. Resend returns no id then.
    if (!(error instanceof Error) || !error.message.includes(IDEMPOTENT_REPLAY_ERROR)) throw error;
    resendId = IDEMPOTENT_REPLAY_ID;
  }

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
