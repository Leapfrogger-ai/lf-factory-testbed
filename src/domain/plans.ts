import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { commits, emailSends, events, plans } from '../db/schema.ts';
import type { AppDeps } from '../web/app.ts';
import type { CommitForm, PublishForm } from '../web/forms.ts';
import { appendEvent } from './events.ts';
import { computeSchedule, deadlineIsStale, defaultDeadline } from './plan-rules.ts';
import type { Suggestion } from './suggestions.ts';
import { localToInstant } from './time.ts';
import { newToken } from './tokens.ts';

export type PlanRow = typeof plans.$inferSelect;
export type CommitRow = typeof commits.$inferSelect;

export type PlanView = {
  id: string;
  state: string;
  publicToken: string;
  manageToken: string;
  checkInToken: string;
  gatheringAt: string;
  commitDeadlineAt: string;
  suggestionId: string | null;
  suggestionEdited: boolean | null;
  count: number;
  manageLinkSent: boolean;
  commits: { isCreator: boolean; withdrawToken: string }[];
  events: { type: string; data: Record<string, unknown> }[];
};

export async function publish(
  deps: Pick<AppDeps, 'db' | 'now' | 'planWorkflows'>,
  form: PublishForm,
  suggestion?: Extract<Suggestion, { outcome: 'ok' }>,
): Promise<{ planId: string; publicToken: string; manageToken: string; creatorCommitId: string }> {
  const gatheringAt = localToInstant(form.date, form.time);
  const submittedDeadline =
    form.deadlineDate === undefined || form.deadlineTime === undefined
      ? undefined
      : localToInstant(form.deadlineDate, form.deadlineTime);
  const deadlineAt =
    submittedDeadline === undefined ||
    (suggestion !== undefined && deadlineIsStale({ gatheringAt, deadlineAt: submittedDeadline }, suggestion))
      ? defaultDeadline(deps.now(), gatheringAt)
      : submittedDeadline;
  const suggestionEdited =
    suggestion === undefined
      ? null
      : form.format !== suggestion.format ||
        form.venue.trim() !== suggestion.venue.trim() ||
        Temporal.Instant.compare(gatheringAt, suggestion.gatheringAt) !== 0 ||
        form.minimum !== suggestion.minimum ||
        Temporal.Instant.compare(deadlineAt, suggestion.commitDeadlineAt) !== 0;
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
        suggestionId: suggestion?.id ?? null,
        suggestionEdited,
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
    return { planId, publicToken, manageToken, creatorCommitId: commit!.id };
  });
}

/** The plan and its creator's commit, the target of the manage-link email. */
export async function loadSendTarget(db: Db, planId: string): Promise<{ plan: PlanRow; commit: CommitRow }> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  const [commit] = await db
    .select()
    .from(commits)
    .where(and(eq(commits.planId, planId), eq(commits.isCreator, true)));
  if (!plan || !commit) throw new Error('No plan with a creator commit for that id');
  return { plan, commit };
}

/** The plan and its active commits, oldest first (the creator's commit comes first), the targets of a call-off email. */
export async function loadSendTargets(db: Db, planId: string): Promise<{ plan: PlanRow; commits: CommitRow[] }> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  if (!plan) throw new Error('No plan for that id');
  const active = await db
    .select()
    .from(commits)
    .where(and(eq(commits.planId, planId), isNull(commits.withdrawnAt)))
    .orderBy(asc(commits.createdAt));
  return { plan, commits: active };
}

/** Called off at its commit deadline when it never reached its minimum; a confirmed or already called-off plan is left alone. */
export async function resolveDeadline(db: Db, planId: string): Promise<{ state: PlanRow['state'] }> {
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, planId)).for('update');
    if (!plan) throw new Error('No plan for that id');
    if (plan.state !== 'open') return { state: plan.state };
    const [active] = await tx
      .select({ value: count() })
      .from(commits)
      .where(and(eq(commits.planId, plan.id), isNull(commits.withdrawnAt)));
    const activeCount = active!.value;
    if (activeCount >= plan.minimum) return { state: plan.state };
    await tx
      .update(plans)
      .set({ state: 'called_off', calledOffAt: sql`now()`, calledOffReason: 'deadline' })
      .where(eq(plans.id, plan.id));
    await appendEvent(tx, {
      planId: plan.id,
      type: 'plan.called_off',
      data: { reason: 'deadline', wasConfirmed: false, activeCount },
    });
    return { state: 'called_off' };
  });
}

export async function loadPlan(db: Db, manageToken: string): Promise<PlanView | null> {
  const [plan] = await db.select().from(plans).where(eq(plans.manageToken, manageToken));
  if (!plan) return null;
  const planCommits = await db.select().from(commits).where(eq(commits.planId, plan.id)).orderBy(asc(commits.createdAt));
  const planEvents = await db.select().from(events).where(eq(events.planId, plan.id)).orderBy(asc(events.id));
  const creator = planCommits.find((c) => c.isCreator);
  const [sent] = creator
    ? await db
        .select({ sentAt: emailSends.sentAt })
        .from(emailSends)
        .where(and(eq(emailSends.commitId, creator.id), eq(emailSends.kind, 'manage_link')))
    : [];
  return {
    id: plan.id,
    state: plan.state,
    publicToken: plan.publicToken,
    manageToken: plan.manageToken,
    checkInToken: plan.checkInToken,
    gatheringAt: plan.gatheringAt.toTemporalInstant().toString(),
    commitDeadlineAt: plan.commitDeadlineAt.toTemporalInstant().toString(),
    suggestionId: plan.suggestionId,
    suggestionEdited: plan.suggestionEdited,
    count: planCommits.filter((c) => c.withdrawnAt === null).length,
    manageLinkSent: sent?.sentAt != null,
    commits: planCommits.map((c) => ({ isCreator: c.isCreator, withdrawToken: c.withdrawToken })),
    events: planEvents.map((e) => ({ type: e.type, data: e.data as Record<string, unknown> })),
  };
}

export type PublicPlan = {
  state: string;
  format: string;
  venue: string;
  city: string;
  gatheringAt: Temporal.Instant;
  commitDeadlineAt: Temporal.Instant;
  minimum: number;
  names: string[];
};

export async function loadPublicPlan(db: Db, publicToken: string): Promise<PublicPlan | null> {
  const rows = await db
    .select({
      state: plans.state,
      format: plans.format,
      venue: plans.venue,
      city: plans.city,
      gatheringAt: plans.gatheringAt,
      commitDeadlineAt: plans.commitDeadlineAt,
      minimum: plans.minimum,
      name: commits.name,
    })
    .from(plans)
    .leftJoin(commits, and(eq(commits.planId, plans.id), isNull(commits.withdrawnAt)))
    .where(eq(plans.publicToken, publicToken))
    .orderBy(asc(commits.createdAt));
  const first = rows[0];
  if (!first) return null;
  return {
    state: first.state,
    format: first.format,
    venue: first.venue,
    city: first.city,
    gatheringAt: first.gatheringAt.toTemporalInstant(),
    commitDeadlineAt: first.commitDeadlineAt.toTemporalInstant(),
    minimum: first.minimum,
    names: rows.flatMap((r) => (r.name === null ? [] : [r.name])),
  };
}

export type CommitResult =
  | { outcome: 'not_found' }
  | { outcome: 'closed' }
  | {
      outcome: 'committed';
      change: 'new' | 'repeat' | 'rejoined';
      commitId: string;
      name: string;
      planId: string;
      confirmed: boolean;
      planConfirmed: boolean;
    };

export async function commit(
  deps: Pick<AppDeps, 'db' | 'now'>,
  publicToken: string,
  form: CommitForm,
): Promise<CommitResult> {
  return deps.db.transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.publicToken, publicToken)).for('update');
    if (!plan) return { outcome: 'not_found' };
    const now = deps.now();
    const pastDeadline = Temporal.Instant.compare(now, plan.commitDeadlineAt.toTemporalInstant()) >= 0;
    const gatheringStarted = Temporal.Instant.compare(now, plan.gatheringAt.toTemporalInstant()) >= 0;
    if (plan.state === 'called_off' || (plan.state === 'open' && pastDeadline) || gatheringStarted) {
      return { outcome: 'closed' };
    }
    const [earlier] = await tx
      .select({ withdrawnAt: commits.withdrawnAt })
      .from(commits)
      .where(and(eq(commits.planId, plan.id), eq(commits.emailNormalized, form.emailNormalized)));
    const [row] = await tx
      .insert(commits)
      .values({
        planId: plan.id,
        name: form.name,
        email: form.email,
        emailNormalized: form.emailNormalized,
        withdrawToken: newToken(),
      })
      .onConflictDoUpdate({ target: [commits.planId, commits.emailNormalized], set: { name: form.name, withdrawnAt: null } })
      .returning({
        id: commits.id,
        name: commits.name,
        isCreator: commits.isCreator,
        inserted: sql<boolean>`(xmax = 0)`,
      });
    const change = row!.inserted ? 'new' : earlier?.withdrawnAt ? 'rejoined' : 'repeat';
    const [active] = await tx
      .select({ value: count() })
      .from(commits)
      .where(and(eq(commits.planId, plan.id), isNull(commits.withdrawnAt)));
    const activeCount = active!.value;
    const confirmed = plan.state === 'open' && activeCount >= plan.minimum && !pastDeadline;
    if (confirmed) {
      await tx
        .update(plans)
        .set({ state: 'confirmed', confirmedAt: new Date(now.epochMilliseconds) })
        .where(eq(plans.id, plan.id));
    }
    await appendEvent(tx, {
      planId: plan.id,
      commitId: row!.id,
      type: 'commit.added',
      data: { change, isCreator: row!.isCreator, activeCount },
    });
    if (confirmed) {
      await appendEvent(tx, { planId: plan.id, type: 'plan.confirmed', data: { activeCount } });
    }
    return {
      outcome: 'committed',
      change,
      commitId: row!.id,
      name: row!.name,
      planId: plan.id,
      confirmed,
      planConfirmed: confirmed || plan.state === 'confirmed',
    };
  });
}

export type WithdrawTarget = {
  state: string;
  format: string;
  venue: string;
  gatheringAt: Temporal.Instant;
  withdrawn: boolean;
};

/** What the withdraw page shows; null when no commit has the token, or it is the creator's. */
export async function loadWithdrawTarget(db: Db, withdrawToken: string): Promise<WithdrawTarget | null> {
  const [row] = await db
    .select({
      state: plans.state,
      format: plans.format,
      venue: plans.venue,
      gatheringAt: plans.gatheringAt,
      withdrawnAt: commits.withdrawnAt,
    })
    .from(commits)
    .innerJoin(plans, eq(plans.id, commits.planId))
    .where(and(eq(commits.withdrawToken, withdrawToken), eq(commits.isCreator, false)));
  if (!row) return null;
  return {
    state: row.state,
    format: row.format,
    venue: row.venue,
    gatheringAt: row.gatheringAt.toTemporalInstant(),
    withdrawn: row.withdrawnAt !== null,
  };
}

export type WithdrawResult =
  | { outcome: 'not_found' }
  | { outcome: 'unavailable' }
  | { outcome: 'already_withdrawn' }
  | { outcome: 'withdrawn'; planId: string; activeCount: number };

export async function withdraw(deps: Pick<AppDeps, 'db' | 'now'>, withdrawToken: string): Promise<WithdrawResult> {
  return deps.db.transaction(async (tx) => {
    const [found] = await tx
      .select({ commitId: commits.id, planId: commits.planId, isCreator: commits.isCreator })
      .from(commits)
      .where(eq(commits.withdrawToken, withdrawToken));
    if (!found || found.isCreator) return { outcome: 'not_found' };
    const [plan] = await tx.select().from(plans).where(eq(plans.id, found.planId)).for('update');
    // Re-read under the plan lock: a simultaneous withdraw may have won it.
    const [row] = await tx.select({ withdrawnAt: commits.withdrawnAt }).from(commits).where(eq(commits.id, found.commitId));
    if (!plan || !row) return { outcome: 'not_found' };
    const now = deps.now();
    if (plan.state === 'called_off' || Temporal.Instant.compare(now, plan.gatheringAt.toTemporalInstant()) >= 0) {
      return { outcome: 'unavailable' };
    }
    if (row.withdrawnAt !== null) return { outcome: 'already_withdrawn' };
    await tx.update(commits).set({ withdrawnAt: new Date(now.epochMilliseconds) }).where(eq(commits.id, found.commitId));
    const [active] = await tx
      .select({ value: count() })
      .from(commits)
      .where(and(eq(commits.planId, plan.id), isNull(commits.withdrawnAt)));
    const activeCount = active!.value;
    await appendEvent(tx, { planId: plan.id, commitId: found.commitId, type: 'commit.withdrawn', data: { activeCount } });
    return { outcome: 'withdrawn', planId: plan.id, activeCount };
  });
}

export async function countPlans(db: Db): Promise<number> {
  const [row] = await db.select({ value: count() }).from(plans);
  return row!.value;
}
