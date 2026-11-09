import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WorkflowNotFoundError, type WorkflowHandle } from '@temporalio/client';
import proto from '@temporalio/proto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeSchedule, type Schedule } from '../../src/domain/plan-rules.ts';
import { callOff, commit, loadPlan, withdraw } from '../../src/domain/plans.ts';
import type { SendEmail } from '../../src/email/send-email.ts';
import { createActivities } from '../../src/temporal/activities.ts';
import { calledOff, committed, confirmed, planWorkflow, type PlanWorkflowInput } from '../../src/temporal/workflows.ts';
import { commitFormSchema } from '../../src/web/forms.ts';
import { publishPlan, TEST_BASE_URL, testDeps } from '../support/builders.ts';
import { fixedClock } from '../support/fakes.ts';
import { resetDb, testDb } from '../support/db.ts';

const { db, pool } = testDb();
const workflowsPath = fileURLToPath(new URL('../../src/temporal/workflows.ts', import.meta.url));
// A recorded history, stored as protobufjs toObject JSON (longs, enums and bytes as strings). The SDK's
// historyFromJSON fails here ("type must be a Type"): @temporalio/common and @temporalio/proto each get
// their own copy of protobufjs 8.8.1 in this install.
const loadHistory = (name: string) =>
  proto.temporal.api.history.v1.History.fromObject(
    JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/workflow/${name}.json`, import.meta.url)), 'utf8')),
  );

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
    // Already past, so these tests see only the open phase and the confirmed emails, no reminders.
    reminder24At: now - 1,
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

  it('sends Not this time to every other committer when the send to Mia is refused (AC5)', async () => {
    const deps = testDeps();
    const published = await publishPlan(deps, { minimum: '4' });
    await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));
    await commit(deps, published.publicToken, form('Raj', 'raj@example.test'));
    deps.fakes.email.rejectTo('mia@example.test');

    await run(deps, published.planId);

    const emails = sent(deps);
    expect(emails.map((e) => e.to)).toEqual(['ann@example.test', 'raj@example.test']);
    for (const e of emails) expect(e.subject).toBe('Not this time: Coffee on Sat 14 Nov');
  });
});

type Sent = { to: string; subject: string; text: string };
const sent = (deps: ReturnType<typeof testDeps>) => deps.fakes.email.calls.map((c) => c.payload as Sent);

/** Waits (real time, short polls) until the fake mailbox holds `count` emails. */
const waitForEmails = (deps: ReturnType<typeof testDeps>, count: number) =>
  vi.waitFor(() => expect(deps.fakes.email.calls.length).toBeGreaterThanOrEqual(count), { timeout: 10_000, interval: 20 });

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

/** Ann's plan with Mia and Raj in (minimum 3); `now` is the fixed clock the plan is published and joined at. */
async function confirmedPlan(overrides: Record<string, string> = {}, now?: string) {
  const deps = testDeps(now === undefined ? {} : { now: fixedClock(now) });
  const published = await publishPlan(deps, { minimum: '3', ...overrides });
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

  it('replays a history recorded before confirmed-emails-3-2', async () => {
    await expect(
      Worker.runReplayHistory({ workflowsPath }, loadHistory('before-confirmed-emails-3-2')),
    ).resolves.toBeUndefined();
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
      await waitForEmails(deps, 3);
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
    const deps = testDeps();
    const published = await publishPlan(deps, { minimum: '4' });
    await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));
    await commit(deps, published.publicToken, form('Raj', 'raj@example.test'));
    const open = await loadPlan(db, published.manageToken);
    expect(open?.state).toBe('open');
    await withdraw(deps, open!.commits.filter((c) => !c.isCreator)[1]!.withdrawToken);
    await commit(deps, published.publicToken, form('Lee', 'lee@example.test'));
    await commit(deps, published.publicToken, form('Kim', 'kim@example.test'));
    expect((await loadPlan(db, published.manageToken))?.state).toBe('confirmed');

    await run(deps, published.planId, 3_600_000, (h) => h.signal(confirmed));

    expect(sent(deps).map((e) => e.to).sort()).toEqual([
      'ann@example.test',
      'kim@example.test',
      'lee@example.test',
      'mia@example.test',
    ]);
  });

  it('sends nothing new for a rejoin signalled after confirmation', async () => {
    const { deps, published, plan } = await confirmedPlan();
    const mia = plan.commits.filter((c) => !c.isCreator)[0]!;

    await run(deps, published.planId, 3_600_000, async (h) => {
      await h.signal(confirmed);
      await waitForEmails(deps, 3);
      await withdraw(deps, mia.withdrawToken);
      const rejoin = await commit(deps, published.publicToken, form('Mia', 'mia@example.test'));
      if (rejoin.outcome !== 'committed') throw new Error('Mia should rejoin');
      await h.signal(committed, rejoin.commitId);
    });

    expect(deps.fakes.email.calls).toHaveLength(3);
  });

  it('sends each committer exactly one confirmation when a send to Mia fails once and is retried (AC3)', async () => {
    const { deps, published } = await confirmedPlan();
    deps.fakes.email.failNextTo('mia@example.test');

    await run(deps, published.planId, 3_600_000, (h) => h.signal(confirmed));

    expect(sent(deps).map((e) => e.to).sort()).toEqual(['ann@example.test', 'mia@example.test', 'raj@example.test']);
  });
});

type Deps = ReturnType<typeof testDeps>;
type TimedSend = { to: string; subject: string; text: string; at: number };

/** The example plan's schedule (plan-rules.test.ts values); checkInAt only needs to be after the morning. */
const EXAMPLE: Schedule = {
  deadlineAt: '2026-11-12T06:00:00Z',
  reminder24At: '2026-11-13T18:00:00Z',
  reminderMorningAt: '2026-11-14T16:00:00Z',
  checkInAt: '2026-11-14T18:01:00Z',
};

/**
 * Records each successful send with the test server's time, then delegates to the fake mailbox. While the
 * server's time is before `failUntil` (absolute server ms, settable once the shift is known), sends that
 * `failWhen` picks throw instead.
 */
function timedEmail(deps: Deps, failWhen: (payload: Sent) => boolean = () => true) {
  const mail = {
    records: [] as TimedSend[],
    failUntil: undefined as number | undefined,
    send: (async (payload, idempotencyKey) => {
      const at = await env.currentTimeMs();
      if (mail.failUntil !== undefined && at < mail.failUntil && failWhen(payload)) {
        throw new Error('email send failed');
      }
      const result = await deps.fakes.email.send(payload, idempotencyKey);
      mail.records.push({ to: payload.to, subject: payload.subject, text: payload.text, at });
      return result;
    }) as SendEmail,
  };
  return mail;
}

/**
 * Like run(), but the workflow's input is `schedule` shifted so that `confirmAt` is the test server's "now".
 * Signals `confirmed` right after start; `act` runs after that and may move time with env.sleep.
 */
async function runSchedule(
  deps: Deps,
  planId: string,
  options: {
    schedule: Schedule;
    confirmAt: string;
    sendEmail?: SendEmail;
    act?: (handle: WorkflowHandle, shift: number) => Promise<void>;
  },
): Promise<number> {
  const { schedule } = options;
  const shift = (await env.currentTimeMs()) - Date.parse(options.confirmAt);
  const input: PlanWorkflowInput = {
    planId,
    deadlineAt: Date.parse(schedule.deadlineAt) + shift,
    reminder24At: Date.parse(schedule.reminder24At) + shift,
    reminderMorningAt: schedule.reminderMorningAt === null ? null : Date.parse(schedule.reminderMorningAt) + shift,
    checkInAt: Date.parse(schedule.checkInAt) + shift,
  };
  queueCount += 1;
  const taskQueue = `plan-workflow-test-${queueCount}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: createActivities({ db, sendEmail: options.sendEmail ?? deps.sendEmail, baseUrl: TEST_BASE_URL }),
  });
  await worker.runUntil(async () => {
    // With the start, so the open phase never starts its (already past) deadline timer: the time-skipping
    // server fails the workflow task that cancels a zero-length timer started in an earlier task.
    const handle = await env.client.workflow.signalWithStart(planWorkflow, {
      workflowId: `plan-${planId}-${taskQueue}`,
      taskQueue,
      args: [input],
      signal: confirmed,
      signalArgs: [],
    });
    await options.act?.(handle, shift);
    await handle.result();
  });
  return shift;
}

/** Expects `at` to be the ISO instant moved by `shift`, within 2s. */
const expectAt = (at: number, iso: string, shift: number) =>
  expect(Math.abs(at - (Date.parse(iso) + shift))).toBeLessThanOrEqual(2000);

const startingWith = (records: TimedSend[], prefix: string) => records.filter((r) => r.subject.startsWith(prefix));

describe('planWorkflow reminders', () => {
  it('sends the 24h and morning reminders to everyone at the example instants', async () => {
    const { deps, published } = await confirmedPlan();
    const mail = timedEmail(deps);

    const shift = await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      sendEmail: mail.send,
    });

    const subjects = mail.records.map((r) => r.subject);
    expect(subjects).toHaveLength(9);
    for (const s of subjects.slice(0, 3)) expect(s).toMatch(/^It's on: /);
    const tomorrow = mail.records.slice(3, 6);
    const today = mail.records.slice(6, 9);
    for (const r of tomorrow) {
      expect(r.subject).toBe('Tomorrow: Coffee at Blue Bottle, 10:00 AM');
      expectAt(r.at, '2026-11-13T18:00:00Z', shift);
    }
    for (const r of today) {
      expect(r.subject).toBe('Today: Coffee at Blue Bottle, 10:00 AM');
      expectAt(r.at, '2026-11-14T16:00:00Z', shift);
    }
    const everyone = ['ann@example.test', 'mia@example.test', 'raj@example.test'];
    expect(tomorrow.map((r) => r.to).sort()).toEqual(everyone);
    expect(today.map((r) => r.to).sort()).toEqual(everyone);
  });

  it('sends only the 24h reminder for a gathering before 10:00', async () => {
    const { deps, published, plan } = await confirmedPlan({ time: '09:30' });
    const schedule = computeSchedule(Temporal.Instant.from(plan.gatheringAt), Temporal.Instant.from(plan.commitDeadlineAt));
    expect(schedule).toEqual({
      deadlineAt: '2026-11-12T05:45:00Z',
      reminder24At: '2026-11-13T17:30:00Z',
      reminderMorningAt: null,
      checkInAt: '2026-11-15T18:00:00Z', // FR027: 10:00 the day after
    });
    const mail = timedEmail(deps);

    const shift = await runSchedule(deps, published.planId, {
      schedule,
      confirmAt: '2026-11-11T18:00:00Z',
      sendEmail: mail.send,
    });

    const tomorrow = startingWith(mail.records, 'Tomorrow:');
    expect(tomorrow.map((r) => r.to).sort()).toEqual(['ann@example.test', 'mia@example.test', 'raj@example.test']);
    for (const r of tomorrow) expectAt(r.at, '2026-11-13T17:30:00Z', shift);
    expect(startingWith(mail.records, 'Today:')).toEqual([]);
  });

  it('skips a 24h reminder already past at confirmation and sends the morning one', async () => {
    const { deps, published } = await confirmedPlan();
    const mail = timedEmail(deps);

    const shift = await runSchedule(deps, published.planId, {
      schedule: { ...EXAMPLE, deadlineAt: '2026-11-14T14:00:00Z' },
      confirmAt: '2026-11-14T04:00:00Z',
      sendEmail: mail.send,
    });

    expect(startingWith(mail.records, 'Tomorrow:')).toEqual([]);
    const today = startingWith(mail.records, 'Today:');
    expect(today).toHaveLength(3);
    for (const r of today) expectAt(r.at, '2026-11-14T16:00:00Z', shift);
  });

  it('sends no reminders for a plan confirmed after the morning reminder time', async () => {
    const { deps, published } = await confirmedPlan();
    const mail = timedEmail(deps);

    await runSchedule(deps, published.planId, {
      schedule: { ...EXAMPLE, deadlineAt: '2026-11-14T17:30:00Z' },
      confirmAt: '2026-11-14T17:00:00Z',
      sendEmail: mail.send,
    });

    expect(mail.records.map((r) => r.subject.split(':')[0])).toEqual(["It's on", "It's on", "It's on"]);
  });

  it('gives a committer who joins after the 24h reminder the confirmation and the morning one only', async () => {
    const { deps, published } = await confirmedPlan();

    await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      act: async (h) => {
        await env.sleep(Date.parse('2026-11-13T18:00:00Z') - Date.parse('2026-11-12T18:00:00Z') + 60_000);
        await vi.waitFor(() => expect(sent(deps).filter((e) => e.subject.startsWith('Tomorrow:'))).toHaveLength(3), {
          timeout: 10_000,
          interval: 20,
        });
        const lee = await commit(deps, published.publicToken, form('Lee', 'lee@example.test'));
        if (lee.outcome !== 'committed') throw new Error('Lee should commit');
        await h.signal(committed, lee.commitId);
      },
    });

    const lee = sent(deps).filter((e) => e.to === 'lee@example.test').map((e) => e.subject);
    expect(lee).toHaveLength(2);
    expect(lee.filter((s) => s.startsWith("It's on:"))).toHaveLength(1);
    expect(lee.filter((s) => s.startsWith('Today:'))).toHaveLength(1);
  });

  it('skips the morning reminder when the 24h one only went out at 3:00 AM', { timeout: 120_000 }, async () => {
    const { deps, published } = await confirmedPlan();
    const mail = timedEmail(deps, (p) => p.subject.startsWith('Tomorrow:'));

    await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      sendEmail: mail.send,
      act: async (_h, shift) => {
        mail.failUntil = Date.parse('2026-11-14T11:00:00Z') + shift;
      },
    });

    expect(startingWith(mail.records, "It's on:")).toHaveLength(3);
    const tomorrow = startingWith(mail.records, 'Tomorrow:');
    expect(tomorrow).toHaveLength(3);
    for (const r of tomorrow) expect(r.at).toBeGreaterThanOrEqual(mail.failUntil!);
    expect(startingWith(mail.records, 'Today:')).toEqual([]);
  });

  it('leaves a committer who withdrew after the 24h reminder out of the morning one', async () => {
    const { deps, published, plan } = await confirmedPlan();
    const raj = plan.commits.filter((c) => !c.isCreator)[1]!;

    await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      act: async () => {
        await env.sleep(Date.parse('2026-11-13T18:00:00Z') - Date.parse('2026-11-12T18:00:00Z') + 60_000);
        await vi.waitFor(() => expect(sent(deps).filter((e) => e.subject.startsWith('Tomorrow:'))).toHaveLength(3), {
          timeout: 10_000,
          interval: 20,
        });
        await withdraw(deps, raj.withdrawToken);
      },
    });

    const today = sent(deps).filter((e) => e.subject.startsWith('Today:'));
    expect(today.map((e) => e.to).sort()).toEqual(['ann@example.test', 'mia@example.test']);
    for (const e of today) expect(e.text).not.toContain('Raj');
  });

  it('replays a history recorded before reminders-in-time-4-3', async () => {
    // Recorded once from the 4.2-era planWorkflow: confirmed signal, then both reminders and the check-in timer.
    await expect(
      Worker.runReplayHistory({ workflowsPath }, loadHistory('before-reminders-in-time-4-3')),
    ).resolves.toBeUndefined();
  });

  it('replays a history recorded before reminders-3-3', async () => {
    const { deps, published } = await confirmedPlan();
    let handle: WorkflowHandle | undefined;
    await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      act: async (h) => {
        handle = h;
      },
    });
    await Worker.runReplayHistory({ workflowsPath }, await handle!.fetchHistory());

    // Recorded once from the 3.2-era planWorkflow (git 2fc774d): confirmed signal, then a late commit's signal.
    await expect(
      Worker.runReplayHistory({ workflowsPath }, loadHistory('before-reminders-3-3')),
    ).resolves.toBeUndefined();
  });

  it.each([
    {
      date: '2026-11-01',
      now: '2026-10-25T18:00:00Z',
      confirmAt: '2026-10-30T18:00:00Z',
      tomorrowAt: '2026-10-31T18:00:00Z',
      todayAt: '2026-11-01T16:00:00Z',
    },
    {
      date: '2027-03-14',
      now: '2027-03-07T18:00:00Z',
      confirmAt: '2027-03-12T18:00:00Z',
      tomorrowAt: '2027-03-13T17:00:00Z',
      todayAt: '2027-03-14T15:00:00Z',
    },
  ])('sends the reminders at the schedule instants for a gathering at 10:00 on $date', async (c) => {
    const { deps, published, plan } = await confirmedPlan({ date: c.date, time: '10:00' }, c.now);
    const schedule = computeSchedule(Temporal.Instant.from(plan.gatheringAt), Temporal.Instant.from(plan.commitDeadlineAt));
    const mail = timedEmail(deps);

    const shift = await runSchedule(deps, published.planId, { schedule, confirmAt: c.confirmAt, sendEmail: mail.send });

    const tomorrow = startingWith(mail.records, 'Tomorrow:');
    const today = startingWith(mail.records, 'Today:');
    expect(tomorrow).toHaveLength(3);
    expect(today).toHaveLength(3);
    for (const r of tomorrow) expectAt(r.at, c.tomorrowAt, shift);
    for (const r of today) expectAt(r.at, c.todayAt, shift);
  });

  it("carries on to the reminders when one committer's address is refused (AC2)", async () => {
    const { deps, published } = await confirmedPlan();
    deps.fakes.email.rejectTo('mia@example.test');
    const mail = timedEmail(deps);

    await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      sendEmail: mail.send,
      act: async (h) => {
        await env.sleep(169_200_000);
        expect((await h.describe()).status.name).toBe('RUNNING');
      },
    });

    expect(mail.records).toHaveLength(6);
    const others = ['ann@example.test', 'raj@example.test'];
    for (const prefix of ["It's on:", 'Tomorrow:', 'Today:']) {
      expect(
        startingWith(mail.records, prefix)
          .map((r) => r.to)
          .sort(),
      ).toEqual(others);
    }
    expect(mail.records.some((r) => r.to === 'mia@example.test')).toBe(false);
  });

  it('a late commit whose send is refused leaves the workflow running and the next reminder reaches everyone else (AC4)', async () => {
    const { deps, published } = await confirmedPlan();
    deps.fakes.email.rejectTo('lee@example.test');
    const mail = timedEmail(deps);

    await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      sendEmail: mail.send,
      act: async (h) => {
        await waitForEmails(deps, 3);
        const lee = await commit(deps, published.publicToken, form('Lee', 'lee@example.test'));
        if (lee.outcome !== 'committed') throw new Error('Lee should commit');
        await h.signal(committed, lee.commitId);
        await env.sleep(3_600_000);
        expect((await h.describe()).status.name).toBe('RUNNING');
      },
    });

    expect(
      startingWith(mail.records, 'Tomorrow:')
        .map((r) => r.to)
        .sort(),
    ).toEqual(['ann@example.test', 'mia@example.test', 'raj@example.test']);
    expect(mail.records.some((r) => r.to === 'lee@example.test')).toBe(false);
  });
});

describe('planWorkflow call-off', () => {
  const NOT_THIS_TIME = 'Not this time: Coffee on Sat 14 Nov';
  const NOT_THIS_TIME_TEXT = "This one didn't come together, and that's fine. Nobody's going, so there's nothing to do.\n";
  const EVERYONE = ['ann@example.test', 'mia@example.test', 'raj@example.test'];
  const PAST_CHECK_IN = Date.parse('2026-11-14T18:01:00Z') - Date.parse('2026-11-12T18:00:00Z') + 60_000;

  it('sends Not this time to everyone and no reminder after a call-off between confirmation and the 24h reminder (AC2)', async () => {
    const { deps, published } = await confirmedPlan();
    const mail = timedEmail(deps);

    await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      sendEmail: mail.send,
      act: async (h) => {
        await waitForEmails(deps, 3);
        expect(await callOff(deps, published.manageToken)).toEqual({ outcome: 'called_off', planId: published.planId });
        await h.signal(calledOff);
        await env.sleep(PAST_CHECK_IN);
      },
    });

    const notThisTime = startingWith(mail.records, 'Not this time:');
    expect(notThisTime.map((r) => r.to).sort()).toEqual(EVERYONE);
    for (const r of notThisTime) {
      expect(r.subject).toBe(NOT_THIS_TIME);
      expect(r.text).toBe(NOT_THIS_TIME_TEXT);
    }
    expect(startingWith(mail.records, 'Tomorrow:')).toEqual([]);
    expect(startingWith(mail.records, 'Today:')).toEqual([]);
  });

  it('sends no morning reminder or check-in after a call-off between the two reminders', async () => {
    const { deps, published } = await confirmedPlan();
    const mail = timedEmail(deps);

    const shift = await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      sendEmail: mail.send,
      act: async (h) => {
        await env.sleep(Date.parse('2026-11-13T18:00:00Z') - Date.parse('2026-11-12T18:00:00Z') + 60_000);
        await vi.waitFor(() => expect(startingWith(mail.records, 'Tomorrow:')).toHaveLength(3), {
          timeout: 10_000,
          interval: 20,
        });
        await callOff(deps, published.manageToken);
        await h.signal(calledOff);
        await env.sleep(PAST_CHECK_IN);
      },
    });

    expect(startingWith(mail.records, 'Tomorrow:').map((r) => r.to).sort()).toEqual(EVERYONE);
    expect(startingWith(mail.records, 'Today:')).toEqual([]);
    const notThisTime = startingWith(mail.records, 'Not this time:');
    expect(notThisTime.map((r) => r.to).sort()).toEqual(EVERYONE);
    // Sent on the signal, not when the morning wait would have run out.
    for (const r of notThisTime) expect(r.at).toBeLessThan(Date.parse('2026-11-14T16:00:00Z') + shift);
  });

  it('sends Not this time once each, and not to a committer who withdrew', async () => {
    const { deps, published, plan } = await confirmedPlan();
    const raj = plan.commits.filter((c) => !c.isCreator)[1]!;
    const mail = timedEmail(deps);

    await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      sendEmail: mail.send,
      act: async (h) => {
        await waitForEmails(deps, 3);
        await withdraw(deps, raj.withdrawToken);
        await callOff(deps, published.manageToken);
        await h.signal(calledOff);
        // The workflow may already have finished handling the first signal; only that error is tolerated.
        await h.signal(calledOff).catch((error: unknown) => {
          if (!(error instanceof WorkflowNotFoundError)) throw error;
        });
        await env.sleep(PAST_CHECK_IN);
      },
    });

    expect(startingWith(mail.records, 'Not this time:').map((r) => r.to).sort()).toEqual([
      'ann@example.test',
      'mia@example.test',
    ]);
    expect(mail.records.filter((r) => r.to === 'raj@example.test').map((r) => r.subject)).toEqual([
      "It's on: Coffee at Blue Bottle, Sat 14 Nov 10:00 AM",
    ]);
  });

  it('replays a history recorded before call-off-3-5', async () => {
    await expect(
      Worker.runReplayHistory({ workflowsPath }, loadHistory('before-call-off-3-5')),
    ).resolves.toBeUndefined();
  });

  it('replays a history recorded with the call-off applied', async () => {
    const { deps, published } = await confirmedPlan();
    let handle: WorkflowHandle | undefined;

    await runSchedule(deps, published.planId, {
      schedule: EXAMPLE,
      confirmAt: '2026-11-12T18:00:00Z',
      act: async (h) => {
        handle = h;
        await waitForEmails(deps, 3);
        await callOff(deps, published.manageToken);
        await h.signal(calledOff);
      },
    });

    await expect(Worker.runReplayHistory({ workflowsPath }, await handle!.fetchHistory())).resolves.toBeUndefined();
  });
});
