import type { emailSends } from '../db/schema.ts';
import type { CommitRow, PlanRow } from '../domain/plans.ts';
import { formatClock, formatDay, formatShareWhen, formatWhen } from '../domain/time.ts';
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
  const format = plan.format.charAt(0).toUpperCase() + plan.format.slice(1);
  const day = formatDay(plan.gatheringAt.toTemporalInstant());
  const mapLine = () =>
    `Map: https://maps.google.com/?${new URLSearchParams({ q: `${plan.venue} ${plan.city}` }).toString()}`;
  const names = () => activeCommits.map((c) => firstName(c.name)).join(', ');
  if (kind === 'check_in') {
    const link = (question: 'happened' | 'attended', answer: 'yes' | 'no') =>
      `${baseUrl}/c/${plan.checkInToken}/${question}/${answer}`;
    const lines = [
      `Hi ${firstName(commit.name)},`,
      `${format} at ${plan.venue} was yesterday. Two quick taps, please.`,
      'Did it happen?',
      `Yes: ${link('happened', 'yes')}`,
      `No: ${link('happened', 'no')}`,
      'Were you there?',
      `Yes: ${link('attended', 'yes')}`,
      `No: ${link('attended', 'no')}`,
      'Thanks!',
      '',
    ];
    return {
      to: commit.email,
      subject: `Did it happen? ${format} on ${day}`,
      text: lines.join('\n'),
      tags: [{ name: 'kind', value: kind }],
    };
  }
  if (kind === 'reminder_24h' || kind === 'reminder_morning') {
    const instant = plan.gatheringAt.toTemporalInstant();
    const lead = kind === 'reminder_24h' ? 'Tomorrow' : 'Today';
    const clock = formatClock(instant);
    const lines = [
      `${lead} at ${clock}: ${format} at ${plan.venue}, ${plan.city}.`,
      mapLine(),
      `Who's in: ${names()}.`,
    ];
    if (!commit.isCreator) lines.push(`Can't make it? Withdraw: ${baseUrl}/w/${commit.withdrawToken}`);
    return {
      to: commit.email,
      subject: `${lead}: ${format} at ${plan.venue}, ${clock}`,
      text: lines.join('\n'),
      tags: [{ name: 'kind', value: kind }],
    };
  }
  if (kind === 'confirmed') {
    const instant = plan.gatheringAt.toTemporalInstant();
    const lines = [
      `It's on. ${names()} are in.`,
      '',
      `${format} at ${plan.venue}`,
      formatWhen(instant),
      mapLine(),
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
