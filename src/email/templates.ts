import type { emailSends } from '../db/schema.ts';
import type { CommitRow, PlanRow } from '../domain/plans.ts';
import { formatDay, formatShareWhen, formatWhen } from '../domain/time.ts';
import { firstName } from '../web/views/public-plan-page.ts';
import type { EmailPayload } from './send-email.ts';

export type EmailKind = typeof emailSends.$inferSelect['kind'];

export function buildEmail(
  kind: EmailKind,
  plan: PlanRow,
  commit: CommitRow,
  baseUrl: string,
  activeCommits: CommitRow[] = [],
): EmailPayload {
  if (kind !== 'manage_link' && kind !== 'not_this_time' && kind !== 'confirmed') {
    throw new Error(`No email template for ${kind}`);
  }
  const format = plan.format.charAt(0).toUpperCase() + plan.format.slice(1);
  const day = formatDay(plan.gatheringAt.toTemporalInstant());
  if (kind === 'confirmed') {
    const instant = plan.gatheringAt.toTemporalInstant();
    const names = activeCommits.map((c) => firstName(c.name)).join(', ');
    const map = new URLSearchParams({ q: `${plan.venue} ${plan.city}` }).toString();
    const lines = [
      `It's on. ${names} are in.`,
      '',
      `${format} at ${plan.venue}`,
      formatWhen(instant),
      `Map: https://maps.google.com/?${map}`,
      '',
      "We'll remind you the day before and that morning.",
      '',
    ];
    if (!commit.isCreator) lines.push(`Can't make it? Withdraw: ${baseUrl}/w/${commit.withdrawToken}`, '');
    return {
      to: commit.email,
      subject: `It's on: ${format} at ${plan.venue}, ${formatShareWhen(instant)}`,
      text: lines.join('\n'),
      tags: [{ name: 'kind', value: kind }],
    };
  }
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
