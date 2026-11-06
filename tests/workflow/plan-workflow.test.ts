import { fileURLToPath } from 'node:url';
import type { WorkflowHandle } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commit, loadPlan, withdraw } from '../../src/domain/plans.ts';
import { createActivities } from '../../src/temporal/activities.ts';
import { committed, confirmed, planWorkflow, type PlanWorkflowInput } from '../../src/temporal/workflows.ts';
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

async function run(
  deps: ReturnType<typeof testDeps>,
  planId: string,
  deadlineOffsetMs = 3_600_000,
  act: (handle: WorkflowHandle) => Promise<void> = async () => {},
) {
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
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start(planWorkflow, {
      workflowId: `plan-${planId}-${taskQueue}`,
      taskQueue,
      args: [input],
    });
    await act(handle);
    await handle.result();
  });
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
    expect(deps.fakes.email.calls).toHaveLength(3);
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

type Sent = { to: string; subject: string; text: string };
const sent = (deps: ReturnType<typeof testDeps>) => deps.fakes.email.calls.map((c) => c.payload as Sent);

const E1_HEAD = [
  "It's on. Ann, Mia, Raj are in.",
  '',
  'Coffee at Blue Bottle',
  'Sat 14 Nov · 10:00 AM',
  'Map: https://maps.google.com/?q=Blue+Bottle+Oakland',
  '',
  "We'll remind you the day before and that morning.",
  '',
];

async function confirmedPlan() {
  const deps = testDeps();
  const published = await publishPlan(deps, { minimum: '3' });
  await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));
  await commit(deps, published.publicToken, form('Raj', 'raj@example.test'));
  const plan = await loadPlan(db, published.manageToken);
  return { deps, published, plan: plan! };
}

describe('planWorkflow confirmed phase', () => {
  it('sends the confirmed email to everyone when the confirmed signal arrives', async () => {
    const { deps, published, plan } = await confirmedPlan();

    await run(deps, published.planId, 3_600_000, (h) => h.signal(confirmed));

    const emails = sent(deps);
    expect(emails).toHaveLength(3);
    const mia = plan.commits.filter((c) => !c.isCreator)[0]!;
    const miaMail = emails.find((e) => e.to === 'mia@example.test')!;
    expect(miaMail.subject).toBe("It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM");
    expect(miaMail.text).toBe(
      [...E1_HEAD, "Can't make it? Withdraw: " + TEST_BASE_URL + '/w/' + mia.withdrawToken, ''].join('\n'),
    );
    const ann = emails.find((e) => e.to === 'ann@example.test')!;
    expect(ann.text).toBe(E1_HEAD.join('\n'));
  });

  it('sends it once each when the confirmed signal arrives twice', async () => {
    const { deps, published } = await confirmedPlan();

    await run(deps, published.planId, 3_600_000, async (h) => {
      await h.signal(confirmed);
      await h.signal(confirmed);
    });

    expect(deps.fakes.email.calls).toHaveLength(3);
  });

  it('gives a late commit the email straight away and nobody else a second one', async () => {
    const { deps, published } = await confirmedPlan();

    await run(deps, published.planId, 3_600_000, async (h) => {
      await h.signal(confirmed);
      const lee = await commit(deps, published.publicToken, form('Lee', 'lee@example.test'));
      if (lee.outcome !== 'committed') throw new Error('Lee should commit');
      await h.signal(committed, lee.commitId);
    });

    const to = sent(deps).map((e) => e.to);
    expect(to).toHaveLength(4);
    expect(to).toContain('lee@example.test');
    expect(new Set(to).size).toBe(4);
  });

  it('confirms at the deadline a plan whose confirmed signal failed', async () => {
    const { deps, published } = await confirmedPlan();

    await run(deps, published.planId);

    const plan = await loadPlan(db, published.manageToken);
    expect(plan?.state).toBe('confirmed');
    const emails = sent(deps);
    expect(emails).toHaveLength(3);
    for (const e of emails) expect(e.subject).toMatch(/^It's on: /);
  });

  it('sends nothing to a committer who withdrew before confirmation', async () => {
    const { deps, published, plan } = await confirmedPlan();
    const raj = plan.commits.filter((c) => !c.isCreator)[1]!;
    await withdraw(deps, raj.withdrawToken);

    await run(deps, published.planId, 3_600_000, (h) => h.signal(confirmed));

    expect(sent(deps).map((e) => e.to).sort()).toEqual(['ann@example.test', 'mia@example.test']);
  });

  it('sends nothing new for a rejoin signalled after confirmation', async () => {
    const { deps, published, plan } = await confirmedPlan();
    const mia = plan.commits.filter((c) => !c.isCreator)[0]!;

    await run(deps, published.planId, 3_600_000, async (h) => {
      await h.signal(confirmed);
      await withdraw(deps, mia.withdrawToken);
      const rejoin = await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));
      if (rejoin.outcome !== 'committed') throw new Error('Mia should rejoin');
      await h.signal(committed, rejoin.commitId);
    });

    expect(deps.fakes.email.calls).toHaveLength(3);
  });
});
