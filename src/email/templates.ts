import type { emailSends } from '../db/schema.ts';
import type { CommitRow, PlanRow } from '../domain/plans.ts';
import { formatDay } from '../domain/time.ts';
import type { EmailPayload } from './send-email.ts';

export type EmailKind = typeof emailSends.$inferSelect['kind'];

export function buildEmail(kind: EmailKind, plan: PlanRow, commit: CommitRow, baseUrl: string): EmailPayload {
  if (kind !== 'manage_link' && kind !== 'not_this_time') throw new Error(`No email template for ${kind}`);
  const format = plan.format.charAt(0).toUpperCase() + plan.format.slice(1);
  const day = formatDay(plan.gatheringAt.toTemporalInstant());
  if (kind === 'not_this_time') {
    return {
      to: commit.email,
      subject: `Not this time: ${format} on ${day}`,
      text: "This one didn't come together, and that's fine. Nobody's going, so there's nothing to do.\n",
      tags: [{ name: 'kind', value: kind }],
    };
  }
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
