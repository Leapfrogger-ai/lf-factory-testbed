import { fileURLToPath } from 'node:url';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commit, loadPlan, withdraw } from '../../src/domain/plans.ts';
import { createActivities } from '../../src/temporal/activities.ts';
import { planWorkflow, type PlanWorkflowInput } from '../../src/temporal/workflows.ts';
import { commitFormSchema } from '../../src/web/forms.ts';
import { publishPlan, TEST_BASE_URL, testDeps } from '../support/builders.ts';
import { resetDb, testDb } from '../support/db.ts';

const { db, pool } = testDb();
const workflowsPath = fileURLToPath(new URL('../../src/temporal/workflows.ts', import.meta.url));

let env: TestWorkflowEnvironment;
let queueCount = 0;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, 120_000);
afterAll(async () => {
  await env?.teardown();
  await pool.end();
});
beforeEach(() => resetDb(db));

const form = (name: string, email: string) => commitFormSchema.parse({ name, email });

async function run(deps: ReturnType<typeof testDeps>, planId: string, deadlineOffsetMs = 3_600_000) {
  const now = await env.currentTimeMs();
  const input: PlanWorkflowInput = {
    planId,
    deadlineAt: now + deadlineOffsetMs,
    reminder24At: now + 7_200_000,
    reminderMorningAt: null,
    checkInAt: now + 10_800_000,
  };
  queueCount += 1;
  const taskQueue = `plan-workflow-test-${queueCount}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: createActivities({ db, sendEmail: deps.sendEmail, baseUrl: TEST_BASE_URL }),
  });
  await worker.runUntil(
    env.client.workflow.execute(planWorkflow, { workflowId: `plan-${planId}-${taskQueue}`, taskQueue, args: [input] }),
  );
}

describe('planWorkflow open phase', () => {
  it('calls off a plan below its minimum at the deadline', async () => {
    const deps = testDeps();
    const published = await publishPlan(deps, { minimum: '3' });
    await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));

    await run(deps, published.planId);

    const plan = await loadPlan(db, published.manageToken);
    expect(plan?.state).toBe('called_off');
    expect(plan?.events).toContainEqual({
      type: 'plan.called_off',
      data: { reason: 'deadline', wasConfirmed: false, activeCount: 2 },
    });
    const payloads = deps.fakes.email.calls.map((c) => c.payload as { subject: string; text: string });
    expect(payloads).toHaveLength(2);
    for (const p of payloads) {
      expect(p.subject).toBe('Not this time: Coffee on Sat 14 Nov');
      expect(p.text).not.toContain('/w/');
    }
  });

  it('sends nothing to a committer who withdrew before the deadline', async () => {
    const deps = testDeps();
    const published = await publishPlan(deps, { minimum: '4' });
    await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));
    await commit(deps, published.publicToken, form('Raj', 'raj@example.test'));
    const plan = await loadPlan(db, published.manageToken);
    const [, raj] = plan!.commits.filter((c) => !c.isCreator);
    await withdraw(deps, raj!.withdrawToken);

    await run(deps, published.planId);

    const to = deps.fakes.email.calls.map((c) => (c.payload as { to: string }).to);
    expect(to).toEqual(['ann@example.test', 'mia@example.test']);
  });

  it('leaves a plan that reached its minimum confirmed when the confirmed signal never arrived', async () => {
    const deps = testDeps();
    const published = await publishPlan(deps, { minimum: '3' });
    await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));
    await commit(deps, published.publicToken, form('Raj', 'raj@example.test'));

    await run(deps, published.planId);

    const plan = await loadPlan(db, published.manageToken);
    expect(plan?.state).toBe('confirmed');
    expect(deps.fakes.email.calls).toHaveLength(0);
  });

  it('retries a failed first send and still sends one email each', async () => {
    const deps = testDeps();
    const published = await publishPlan(deps, { minimum: '3' });
    await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));
    deps.fakes.email.failNext();

    await run(deps, published.planId);

    expect(deps.fakes.email.attempts).toHaveLength(3);
    expect(deps.fakes.email.calls).toHaveLength(2);
  });

  it('resolves a plan whose deadline is already past', async () => {
    const deps = testDeps();
    const published = await publishPlan(deps, { minimum: '3' });
    await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));

    await run(deps, published.planId, -1000);

    const plan = await loadPlan(db, published.manageToken);
    expect(plan?.state).toBe('called_off');
    expect(deps.fakes.email.calls).toHaveLength(2);
  });
});
