export type PlanWorkflowInput = {
  planId: string;
  deadlineAt: number;
  reminder24At: number;
  reminderMorningAt: number | null;
  checkInAt: number;
};

// No timers yet (Epic 3). Workflow code imports only @temporalio/workflow.
export async function planWorkflow(_input: PlanWorkflowInput): Promise<void> {}
