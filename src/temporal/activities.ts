import type { Db } from '../db/client.ts';
import { loadSendTargets, resolveDeadline } from '../domain/plans.ts';
import type { SendEmail } from '../email/send-email.ts';
import { sendOnce, type EmailKind } from '../email/send.ts';

export type Activities = ReturnType<typeof createActivities>;

/** The plan state each email kind may be sent in. */
const REQUIRED_STATE: Partial<Record<EmailKind, string>> = {
  not_this_time: 'called_off',
  confirmed: 'confirmed',
};

function requiredState(kind: EmailKind): string {
  const required = REQUIRED_STATE[kind];
  if (required === undefined) throw new Error('No activity support for ' + kind);
  return required;
}

export function createActivities(deps: { db: Db; sendEmail: SendEmail; baseUrl: string }) {
  return {
    async resolveDeadline(planId: string): Promise<'open' | 'confirmed' | 'called_off'> {
      const { state } = await resolveDeadline(deps.db, planId);
      return state;
    },

    async sendToCommitters(planId: string, kind: EmailKind): Promise<void> {
      const required = requiredState(kind);
      const { plan, commits } = await loadSendTargets(deps.db, planId);
      if (plan.state !== required) return;
      for (const commit of commits) await sendOnce(deps, kind, plan, commit, commits);
    },

    /** Sends one committer their email, if the plan is still in the kind's state and that commit is still active. */
    async sendToOne(planId: string, kind: EmailKind, commitId: string): Promise<void> {
      const required = requiredState(kind);
      const { plan, commits } = await loadSendTargets(deps.db, planId);
      if (plan.state !== required) return;
      const target = commits.find((c) => c.id === commitId);
      if (!target) return;
      await sendOnce(deps, kind, plan, target, commits);
    },
  };
}
