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

// The reminder sends keep retrying for up to 20h, so a send failing overnight still goes out late (and the
// 6h rule then skips the morning one). An exhausted reminder send fails the workflow.
const reminders = proxyActivities<Activities>({
  startToCloseTimeout: '30s',
  scheduleToCloseTimeout: '20h',
  retry: { initialInterval: '5s', backoffCoefficient: 2, maximumInterval: '10m' },
});

const SIX_HOURS_MS = 6 * 3_600_000;

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

  /** Waits until `at`, sending each late commit its confirmed email as its signal arrives. */
  async function waitUntil(at: number): Promise<void> {
    for (;;) {
      const remaining = at - Date.now();
      // No zero-length timer: an instant already passed only drains the queue below.
      if (remaining <= 0) break;
      const woke = await condition(() => lateCommitIds.length > 0, remaining);
      if (!woke) break;
      await activities.sendToOne(input.planId, 'confirmed', lateCommitIds.shift()!);
    }
    while (lateCommitIds.length > 0) await activities.sendToOne(input.planId, 'confirmed', lateCommitIds.shift()!);
  }

  // Gated so a history recorded by the open-phase-only workflow still replays.
  if (isConfirmed && !isCalledOff && patched('confirmed-emails-3-2')) {
    await activities.sendToCommitters(input.planId, 'confirmed');
    // Gated so a history recorded by story 3.2's workflow (placeholder wait) still replays.
    if (patched('reminders-3-3')) {
      let sent24At: number | null = null;
      if (input.reminder24At > Date.now()) {
        await waitUntil(input.reminder24At);
        await reminders.sendToCommitters(input.planId, 'reminder_24h');
        sent24At = Date.now();
      }
      const morningAt = input.reminderMorningAt;
      // FR021: skip the morning reminder when the 24h one actually went out less than 6h before it.
      if (morningAt !== null && morningAt > Date.now() && !(sent24At !== null && morningAt - sent24At < SIX_HOURS_MS)) {
        await waitUntil(morningAt);
        await reminders.sendToCommitters(input.planId, 'reminder_morning');
      }
      // Placeholder end of the confirmed phase: Epic 4 adds the check-in here.
      await waitUntil(input.checkInAt);
    } else {
      // Placeholder end of the confirmed phase: story 3.3 replaces this wait with the reminder timers.
      const endAt = input.checkInAt;
      for (;;) {
        const woke = await condition(() => lateCommitIds.length > 0, Math.max(endAt - Date.now(), 0));
        if (!woke) break;
        await activities.sendToOne(input.planId, 'confirmed', lateCommitIds.shift()!);
      }
    }
  }
}
