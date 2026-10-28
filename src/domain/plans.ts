import { asc, count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { commits, events, plans } from '../db/schema.ts';
import type { AppDeps } from '../web/app.ts';
import type { PublishForm } from '../web/forms.ts';
import { appendEvent } from './events.ts';
import { computeSchedule, defaultDeadline } from './plan-rules.ts';
import { localToInstant } from './time.ts';
import { newToken } from './tokens.ts';

export type PlanView = {
  id: string;
  state: string;
  publicToken: string;
  manageToken: string;
  checkInToken: string;
  gatheringAt: string;
  commitDeadlineAt: string;
  count: number;
  commits: { isCreator: boolean; withdrawToken: string }[];
  events: { type: string; data: Record<string, unknown> }[];
};

export async function publish(
  deps: Pick<AppDeps, 'db' | 'now' | 'planWorkflows'>,
  form: PublishForm,
): Promise<{ planId: string; publicToken: string; manageToken: string }> {
  const gatheringAt = localToInstant(form.date, form.time);
  const deadlineAt =
    form.deadlineDate === undefined || form.deadlineTime === undefined
      ? defaultDeadline(deps.now(), gatheringAt)
      : localToInstant(form.deadlineDate, form.deadlineTime);
  const schedule = computeSchedule(gatheringAt, deadlineAt);
  const publicToken = newToken();
  const manageToken = newToken();

  return deps.db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(plans)
      .values({
        publicToken,
        manageToken,
        checkInToken: newToken(),
        city: form.city,
        area: form.area,
        timeWindow: form.timeWindow,
        format: form.format,
        venue: form.venue,
        gatheringAt: new Date(gatheringAt.epochMilliseconds),
        commitDeadlineAt: new Date(deadlineAt.epochMilliseconds),
        minimum: form.minimum,
        state: 'open',
      })
      .returning({ id: plans.id });
    const planId = plan!.id;
    const [commit] = await tx
      .insert(commits)
      .values({
        planId,
        name: form.name,
        email: form.email,
        emailNormalized: form.emailNormalized,
        isCreator: true,
        withdrawToken: newToken(),
      })
      .returning({ id: commits.id });
    await appendEvent(tx, { planId, type: 'plan.published', data: { fromPlanId: null } });
    await appendEvent(tx, {
      planId,
      commitId: commit!.id,
      type: 'commit.added',
      data: { change: 'new', isCreator: true, activeCount: 1 },
    });
    await deps.planWorkflows.start(planId, schedule);
    return { planId, publicToken, manageToken };
  });
}

export async function loadPlan(db: Db, manageToken: string): Promise<PlanView | null> {
  const [plan] = await db.select().from(plans).where(eq(plans.manageToken, manageToken));
  if (!plan) return null;
  const planCommits = await db.select().from(commits).where(eq(commits.planId, plan.id)).orderBy(asc(commits.createdAt));
  const planEvents = await db.select().from(events).where(eq(events.planId, plan.id)).orderBy(asc(events.id));
  return {
    id: plan.id,
    state: plan.state,
    publicToken: plan.publicToken,
    manageToken: plan.manageToken,
    checkInToken: plan.checkInToken,
    gatheringAt: plan.gatheringAt.toTemporalInstant().toString(),
    commitDeadlineAt: plan.commitDeadlineAt.toTemporalInstant().toString(),
    count: planCommits.filter((c) => c.withdrawnAt === null).length,
    commits: planCommits.map((c) => ({ isCreator: c.isCreator, withdrawToken: c.withdrawToken })),
    events: planEvents.map((e) => ({ type: e.type, data: e.data as Record<string, unknown> })),
  };
}

export async function countPlans(db: Db): Promise<number> {
  const [row] = await db.select({ value: count() }).from(plans);
  return row!.value;
}
