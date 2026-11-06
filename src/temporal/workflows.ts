import { condition, defineSignal, patched, proxyActivities, setHandler } from '@temporalio/workflow';
import type { Activities } from './activities.ts';

export type PlanWorkflowInput = {
  planId: string;
  deadlineAt: number;
  reminder24At: number;
  reminderMorningAt: number | null;
  checkInAt: number;
};

export const confirmed = defineSignal<[]>('confirmed');
export const committed = defineSignal<[string]>('committed');
export const calledOff = defineSignal<[]>('calledOff');

const activities = proxyActivities<Activities>({
  startToCloseTimeout: '30s',
  scheduleToCloseTimeout: '12h',
  retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '10m' },
});

// Open phase, then the confirmed emails (story 3.2). Workflow code imports only @temporalio/workflow.
export async function planWorkflow(input: PlanWorkflowInput): Promise<void> {
  let isConfirmed = false;
  let isCalledOff = false;
  setHandler(confirmed, () => {
    isConfirmed = true;
  });
  const lateCommitIds: string[] = [];
  setHandler(committed, (commitId) => {
    lateCommitIds.push(commitId);
  });
  setHandler(calledOff, () => {
    isCalledOff = true;
  });

  await condition(() => isConfirmed || isCalledOff, Math.max(input.deadlineAt - Date.now(), 0));

  if (!isConfirmed && !isCalledOff) {
    const state = await activities.resolveDeadline(input.planId);
    isCalledOff = state === 'called_off';
    isConfirmed = state === 'confirmed';
  }
  if (isCalledOff) await activities.sendToCommitters(input.planId, 'not_this_time');

  // Gated so a history recorded by the open-phase-only workflow still replays.
  if (isConfirmed && !isCalledOff && patched('confirmed-emails-3-2')) {
    await activities.sendToCommitters(input.planId, 'confirmed');
    // Placeholder end of the confirmed phase: story 3.3 replaces this wait with the reminder timers.
    const endAt = input.checkInAt;
    for (;;) {
      const woke = await condition(() => lateCommitIds.length > 0, Math.max(endAt - Date.now(), 0));
      if (!woke) break;
      await activities.sendToOne(input.planId, 'confirmed', lateCommitIds.shift()!);
    }
  }
}
