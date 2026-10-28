import { Client, Connection } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import type { Schedule } from '../domain/plan-rules.ts';
import type { AppDeps } from '../web/app.ts';
import { planWorkflow } from './workflows.ts';

export const TASK_QUEUE = 'calvin';

function epochMs(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

export function createPlanWorkflows(client: Client): AppDeps['planWorkflows'] {
  return {
    async start(planId: string, schedule: Schedule): Promise<void> {
      await client.workflow.start(planWorkflow, {
        workflowId: `plan-${planId}`,
        taskQueue: TASK_QUEUE,
        args: [
          {
            planId,
            deadlineAt: epochMs(schedule.deadlineAt),
            reminder24At: epochMs(schedule.reminder24At),
            reminderMorningAt: schedule.reminderMorningAt === null ? null : epochMs(schedule.reminderMorningAt),
            checkInAt: epochMs(schedule.checkInAt),
          },
        ],
      });
    },
    async signal(): Promise<void> {
      throw new Error('Signalling a plan workflow is not available yet');
    },
  };
}

export async function connectTemporalClient(): Promise<Client> {
  const { connectionOptions, namespace } = loadClientConnectConfig();
  const connection = await Connection.connect(connectionOptions);
  return new Client({ connection, namespace });
}
