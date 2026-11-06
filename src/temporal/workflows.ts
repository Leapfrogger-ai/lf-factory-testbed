import { condition, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';
import type { Activities } from './activities.ts';

export type PlanWorkflowInput = {
  planId: string;
  deadlineAt: number;
  reminder24At: number;
  reminderMorningAt: number | null;
  checkInAt: number;
};

export const confirmed = defineSignal<[]>('confirmed');
export const calledOff = defineSignal<[]>('calledOff');

const activities = proxyActivities<Activities>({
  startToCloseTimeout: '30s',
  scheduleToCloseTimeout: '12h',
  retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '10m' },
});

// Open phase only; the confirmed phase is story 3.2. Workflow code imports only @temporalio/workflow.
export async function planWorkflow(input: PlanWorkflowInput): Promise<void> {
  let isConfirmed = false;
  let isCalledOff = false;
  setHandler(confirmed, () => {
    isConfirmed = true;
  });
  setHandler(calledOff, () => {
    isCalledOff = true;
  });

  await condition(() => isConfirmed || isCalledOff, Math.max(input.deadlineAt - Date.now(), 0));

  if (!isConfirmed && !isCalledOff) {
    isCalledOff = (await activities.resolveDeadline(input.planId)) === 'called_off';
  }
  if (isCalledOff) await activities.sendToCommitters(input.planId, 'not_this_time');
}
