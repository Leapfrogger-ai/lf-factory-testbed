import { ApplicationFailure } from '@temporalio/activity';
import type { Db } from '../db/client.ts';
import { loadSendTargets, resolveDeadline } from '../domain/plans.ts';
import type { SendEmail } from '../email/send-email.ts';
import { sendOnce, type EmailKind } from '../email/send.ts';
import { log } from '../log.ts';

export type Activities = ReturnType<typeof createActivities>;

/** The plan state each email kind may be sent in. */
const REQUIRED_STATE: Partial<Record<EmailKind, string>> = {
  not_this_time: 'called_off',
  confirmed: 'confirmed',
  reminder_24h: 'confirmed',
  reminder_morning: 'confirmed',
  check_in: 'confirmed',
};

function requiredState(kind: EmailKind): string {
  const required = REQUIRED_STATE[kind];
  if (required === undefined) throw new Error('No activity support for ' + kind);
  return required;
}

/** Runs one send; a non-retryable failure is logged and skipped so it cannot block the others. Anything else is rethrown. */
async function sendOrSkip(planId: string, kind: EmailKind, send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (error) {
    if (!(error instanceof ApplicationFailure) || !error.nonRetryable) throw error;
    log.error('email skipped: non-retryable send failure', { planId, kind, errorName: error.type });
  }
}

type SendDeps = Parameters<typeof sendOnce>[0];
type SendPlan = Parameters<typeof sendOnce>[2];
type SendCommit = Parameters<typeof sendOnce>[3];
type SendCommits = Parameters<typeof sendOnce>[4];

const REMINDER_KINDS: EmailKind[] = ['reminder_24h', 'reminder_morning'];

/** A reminder reaches a committer only after their "It's on" email, so a late committer gets both in order. */
async function sendWithPrerequisite(
  deps: SendDeps,
  kind: EmailKind,
  plan: SendPlan,
  commit: SendCommit,
  commits: SendCommits,
): Promise<void> {
  if (REMINDER_KINDS.includes(kind)) await sendOnce(deps, 'confirmed', plan, commit, commits);
  await sendOnce(deps, kind, plan, commit, commits);
}

export function createActivities(deps: { db: Db; sendEmail: SendEmail; baseUrl: string }) {
  return {
    async resolveDeadline(planId: string): Promise<'open' | 'confirmed' | 'called_off'> {
      const { state } = await resolveDeadline(deps.db, planId);
      return state;
    },

    /** The plan's state in Postgres right now; read-only. */
    async planState(planId: string): Promise<'open' | 'confirmed' | 'called_off'> {
      return (await loadSendTargets(deps.db, planId)).plan.state;
    },

    async sendToCommitters(planId: string, kind: EmailKind): Promise<void> {
      const required = requiredState(kind);
      const { plan, commits } = await loadSendTargets(deps.db, planId);
      if (plan.state !== required) return;
      for (const commit of commits) {
        await sendOrSkip(planId, kind, () => sendWithPrerequisite(deps, kind, plan, commit, commits));
      }
    },

    /** Sends one committer their email, if the plan is still in the kind's state and that commit is still active. */
    async sendToOne(planId: string, kind: EmailKind, commitId: string): Promise<void> {
      const required = requiredState(kind);
      const { plan, commits } = await loadSendTargets(deps.db, planId);
      if (plan.state !== required) return;
      const target = commits.find((c) => c.id === commitId);
      if (!target) return;
      await sendOrSkip(planId, kind, () => sendWithPrerequisite(deps, kind, plan, target, commits));
    },

    /** Asks the plan's creator whether it happened, if the plan is confirmed and the creator is still active. */
    async sendCheckIn(planId: string): Promise<void> {
      const required = requiredState('check_in');
      const { plan, commits } = await loadSendTargets(deps.db, planId);
      if (plan.state !== required) return;
      const creator = commits.find((c) => c.isCreator);
      if (!creator) return;
      await sendOrSkip(planId, 'check_in', () => sendOnce(deps, 'check_in', plan, creator, commits));
    },
  };
}
