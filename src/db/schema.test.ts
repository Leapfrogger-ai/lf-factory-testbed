import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { checkInAnswers, commits, emailSends, events, plans, suggestions } from './schema.ts';

describe('schema', () => {
  it('names the six tables', () => {
    const tables = [suggestions, plans, commits, emailSends, checkInAnswers, events];
    const names = tables.map((t) => getTableConfig(t).name);
    expect(names).toEqual(['suggestions', 'plans', 'commits', 'email_sends', 'check_in_answers', 'events']);
  });

  it('keeps plans state/timestamps check', () => {
    const checks = getTableConfig(plans).checks.map((c) => c.name);
    expect(checks).toContain('plans_state_timestamps_check');
  });

  it('keeps the one-commit-per-email-per-plan unique constraint', () => {
    const uniques = getTableConfig(commits).uniqueConstraints.map((u) => u.name);
    expect(uniques).toContain('commits_plan_id_email_normalized_key');
  });
});
