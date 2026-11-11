/**
 * The Epic 4 showcase (lf-factory idea 19, a hand-made trial): seeds the example plans through the app's
 * own code, runs the real plan workflow on Temporal's time-skipping test server with the test email fake,
 * screenshots the pages in headless Chromium, and writes epic-4.html beside this file.
 *
 *   npx vitest run --config specs/calvin-5/showcase/vitest.config.ts
 *
 * With SHOWCASE_SERVE=1 it keeps the app up on http://localhost:8091 afterwards and prints a link for each
 * state (Ctrl-C to stop). No real email is sent and no credential is read: email goes to the test fake,
 * and the AI suggestion call is the test fake too.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, it } from 'vitest';
import { events } from '../../../src/db/schema.ts';
import type { Schedule } from '../../../src/domain/plan-rules.ts';
import { commit, loadPlan } from '../../../src/domain/plans.ts';
import type { SendEmail } from '../../../src/email/send-email.ts';
import { createActivities } from '../../../src/temporal/activities.ts';
import { confirmed, planWorkflow, type PlanWorkflowInput } from '../../../src/temporal/workflows.ts';
import { createApp } from '../../../src/web/app.ts';
import { commitFormSchema } from '../../../src/web/forms.ts';
import { publishPlan, testDeps } from '../../../tests/support/builders.ts';
import { resetDb, testDb } from '../../../tests/support/db.ts';
import { trialQueries } from '../../../tests/support/trial-metrics.ts';
import { STORIES } from './stories.ts';

const PORT = 8091;
const BASE = `http://localhost:${PORT}`;
const here = fileURLToPath(new URL('.', import.meta.url));
const shotsDir = fileURLToPath(new URL('../../../.factory/showcase/', import.meta.url));
const workflowsPath = fileURLToPath(new URL('../../../src/temporal/workflows.ts', import.meta.url));

// The example plan (epics.md): coffee at Blue Bottle, Sat 14 Nov 2026 10:00 AM Pacific.
const EXAMPLE: Schedule = {
  deadlineAt: '2026-11-12T06:00:00Z',
  reminder24At: '2026-11-13T18:00:00Z',
  reminderMorningAt: '2026-11-14T16:00:00Z',
  checkInAt: '2026-11-15T18:00:00Z',
  gatheringAt: '2026-11-14T18:00:00Z',
};

const { db, pool } = testDb();
let env: TestWorkflowEnvironment;
let clock = Temporal.Instant.from('2026-11-09T18:00:00Z');
let signalsFail = false;
const deps = testDeps({
  now: () => clock,
  planWorkflows: {
    start: async () => {},
    // The showcase drives the workflow itself; with signalsFail every calledOff signal is lost (Story 4.4).
    signal: async () => {
      if (signalsFail) throw new Error('signal failed');
    },
  },
});
const app = createApp(deps, { baseUrl: BASE });
const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' });

type Mail = { id: string; to: string; subject: string; text: string; at: string };
const mails: Mail[] = [];
type Page = { id: string; title: string; path: string; status: number; html: string; note?: string; height?: number };
const pages: Page[] = [];

beforeAll(async () => {
  await resetDb(db);
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, 120_000);
afterAll(async () => {
  await env?.teardown();
  server.close();
  await pool.end();
});

const form = (name: string, email: string) => commitFormSchema.parse({ name, email });
const pacific = (ms: number) =>
  Temporal.Instant.fromEpochMilliseconds(ms)
    .toZonedDateTimeISO('America/Los_Angeles')
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' })
    .replace('T', ' ');

async function examplePlan(creator: string, email: string) {
  const published = await publishPlan(deps, { name: creator, email, minimum: '3' });
  await commit(deps, published.publicToken, form('Mia', `mia.${creator.toLowerCase()}@example.test`));
  await commit(deps, published.publicToken, form('Raj', `raj.${creator.toLowerCase()}@example.test`));
  return { published, plan: (await loadPlan(db, published.manageToken))! };
}

/** Runs the real plan workflow for the example schedule, confirmed at `confirmAt`; records every email. */
async function runWorkflow(planId: string, label: string, confirmAt: string, act?: () => Promise<void>) {
  const shift = (await env.currentTimeMs()) - Date.parse(confirmAt);
  const at = (iso: string | null) => (iso === null ? null : Date.parse(iso) + shift);
  const input: PlanWorkflowInput = {
    planId,
    deadlineAt: at(EXAMPLE.deadlineAt)!,
    reminder24At: at(EXAMPLE.reminder24At)!,
    reminderMorningAt: at(EXAMPLE.reminderMorningAt),
    checkInAt: at(EXAMPLE.checkInAt)!,
    gatheringAt: at(EXAMPLE.gatheringAt)!,
  };
  const send: SendEmail = async (payload, key) => {
    const result = await deps.fakes.email.send(payload, key);
    const kind = payload.tags?.find((t) => t.name === 'kind')?.value ?? 'email';
    mails.push({
      id: `${label}-${kind}-${payload.to.split('@')[0]}`,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      at: pacific((await env.currentTimeMs()) - shift),
    });
    return result;
  };
  const taskQueue = `showcase-${label}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: createActivities({ db, sendEmail: send, baseUrl: BASE }),
  });
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.signalWithStart(planWorkflow, {
      workflowId: `plan-${planId}-${taskQueue}`,
      taskQueue,
      args: [input],
      signal: confirmed,
      signalArgs: [],
    });
    await act?.();
    await handle.result();
  });
}

async function page(id: string, title: string, path: string, options: { note?: string; open?: boolean; height?: number } = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  let html = await res.text();
  if (options.open) html = html.replace('<details class="calloff">', '<details class="calloff" open>');
  pages.push({ id, title, path, status: res.status, html, note: options.note, height: options.height });
}

// Async: the app serving the page's CSS runs in this same process.
async function screenshot(p: Page): Promise<string> {
  mkdirSync(shotsDir, { recursive: true });
  const file = `${shotsDir}${p.id}.html`;
  const png = `${shotsDir}${p.id}.png`;
  writeFileSync(file, p.html.replace('<head>', `<head><base href="${BASE}/">`));
  await promisify(execFile)(
    'chromium',
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      `--window-size=390,${p.height ?? 520}`,
      `--screenshot=${png}`,
      `file://${file}`,
    ],
    { timeout: 60_000 },
  );
  return readFileSync(png).toString('base64');
}

it('captures Epic 4', async () => {
  // Plan A: Ana's example plan, confirmed, run to the end: It's on, both reminders, the check-in (4.3, 4.5).
  const a = await examplePlan('Ana', 'ana@example.test');
  await runWorkflow(a.published.planId, 'a', '2026-11-12T18:00:00Z');

  // The check-in answers, in the stories' order (4.6 AC1-AC3), then attended-first on plan B (AC4).
  const c = (token: string, q: string, ans: string) => `/c/${token}/${q}/${ans}`;
  await page('checkin-happened-yes', 'Did it happen? Yes (first answer)', c(a.plan.checkInToken, 'happened', 'yes'));
  await page('checkin-happened-no', 'Changed to No', c(a.plan.checkInToken, 'happened', 'no'));
  await page('checkin-attended-no', 'Were you there? No (both answered)', c(a.plan.checkInToken, 'attended', 'no'));
  const b = await examplePlan('Bea', 'bea@example.test');
  await page('checkin-attended-yes-first', 'Were you there? Yes (first answer)', c(b.plan.checkInToken, 'attended', 'yes'));
  await page('checkin-bad-answer', 'A bad link: answer "perhaps"', c(a.plan.checkInToken, 'happened', 'perhaps'));

  // Plan C: confirmed, then the creator calls it off on Thu 12 Nov and every calledOff signal is lost (4.4).
  const cc = await examplePlan('Cal', 'cal@example.test');
  clock = Temporal.Instant.from('2026-11-12T17:30:00Z');
  await page('manage-confirmed', "Manage page, It's on, with Call it off opened", `/m/${cc.published.manageToken}`, {
    open: true,
    height: 1000,
    note: 'The confirm step is a <details> element; the capture opens it, as a tap on "Call it off" would.',
  });
  signalsFail = true;
  await runWorkflow(cc.published.planId, 'c', '2026-11-12T17:00:00Z', async () => {
    const res = await fetch(`${BASE}/m/${cc.published.manageToken}/call-off`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Origin: BASE, 'Sec-Fetch-Site': 'same-origin' },
    });
    if (res.status !== 303) throw new Error(`call-off answered ${res.status}`);
  });
  await page('manage-called-off', 'Manage page after the call-off', `/m/${cc.published.manageToken}`, { height: 900 });
  await page('checkin-called-off', "A called-off plan's check-in link", c(cc.plan.checkInToken, 'happened', 'yes'));

  // Evidence from the database: plan A's events, and every trial metric query (4.7).
  const planEvents = await db
    .select()
    .from(events)
    .where(eq(events.planId, a.published.planId))
    .orderBy(asc(events.id));
  const queries: { sql: string; rows: Record<string, unknown>[] }[] = [];
  for (const sql of trialQueries()) {
    const result = await pool.query(sql);
    queries.push({ sql, rows: result.rows });
  }

  const shots: Record<string, string> = {};
  for (const p of pages) shots[p.id] = await screenshot(p);
  writeFileSync(
    `${here}epic-4.html`,
    render({ shots, planEvents: planEvents.map((e) => ({ type: e.type, at: e.createdAt, data: e.data })), queries }),
  );

  if (process.env.SHOWCASE_SERVE) {
    console.log(`\nThe app is up on ${BASE} (Ctrl-C to stop). Each state:`);
    for (const p of pages) console.log(`  ${p.title}: ${BASE}${p.path}`);
    await new Promise(() => {});
  }
});

// ---- the page ----

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function linkify(text: string): string {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}

function render(data: {
  shots: Record<string, string>;
  planEvents: { type: string; at: Date; data: unknown }[];
  queries: { sql: string; rows: Record<string, unknown>[] }[];
}): string {
  const shotFigure = (id: string) => {
    const p = pages.find((x) => x.id === id)!;
    return `<figure class="shot" id="shot-${id}">
  <img src="data:image/png;base64,${data.shots[id]}" alt="${esc(p.title)}" width="390">
  <figcaption><strong>${esc(p.title)}</strong><br><code>GET ${esc(p.path.replace(/\/[A-Za-z0-9_-]{20,}/g, '/<token>'))}</code> → ${p.status}${p.note ? `<br><span class="muted">${esc(p.note)}</span>` : ''}</figcaption>
</figure>`;
  };
  const mailCard = (m: Mail) => `<article class="mail" id="mail-${m.id}">
  <header><div><span class="k">From</span> calvin</div><div><span class="k">To</span> ${esc(m.to)}</div>
  <div><span class="k">Sent</span> ${esc(m.at)} Pacific (workflow time)</div>
  <div class="subj">${esc(m.subject)}</div></header>
  <pre>${linkify(m.text)}</pre>
</article>`;
  const firstMail = (prefix: string, to?: string) =>
    mails.find((m) => m.subject.startsWith(prefix) && (to === undefined || m.to === to));
  const shown = [
    firstMail("It's on", 'mia.ana@example.test'),
    firstMail('Tomorrow', 'mia.ana@example.test'),
    firstMail('Today', 'mia.ana@example.test'),
    firstMail('Did it happen?'),
    firstMail('Not this time', 'mia.cal@example.test'),
  ].filter((m): m is Mail => m !== undefined);

  const evidence = (e: (typeof STORIES)[number]['acs'][number]['evidence'][number]) => {
    if ('shot' in e) return `<a href="#shot-${e.shot}">screenshot: ${esc(pages.find((p) => p.id === e.shot)?.title ?? e.shot)}</a>`;
    if ('mail' in e) {
      const m = firstMail(e.mail, e.to);
      return m ? `<a href="#mail-${m.id}">email: ${esc(m.subject)}</a>` : `<span class="no">email not captured</span>`;
    }
    if ('test' in e) return `<span class="test">test: <code>${esc(e.test)}</code></span>`;
    if ('db' in e) return `<a href="#${e.db}">${esc(e.label)}</a>`;
    return `<span class="no">not shown: ${esc(e.notShown)}</span>`;
  };

  const storyBlocks = STORIES.map(
    (s) => `<section class="story" id="story-${s.id}">
  <h3>Story ${s.id}: ${esc(s.title)}</h3>
  <p>${esc(s.summary)}</p>
  <table class="acs"><thead><tr><th>Acceptance criterion</th><th>Evidence</th></tr></thead><tbody>
  ${s.acs.map((ac) => `<tr><td>${esc(ac.text)}</td><td>${ac.evidence.map(evidence).join('<br>')}</td></tr>`).join('\n  ')}
  </tbody></table>
</section>`,
  ).join('\n');

  const table = (rows: Record<string, unknown>[]) => {
    if (rows.length === 0) return '<p class="muted">(no rows)</p>';
    const cols = Object.keys(rows[0]!);
    const cell = (v: unknown) => esc(v instanceof Date ? v.toISOString() : v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    return `<table class="data"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${cols.map((c) => `<td>${cell(r[c])}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
  };

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>calvin Epic 4 showcase</title>
<style>
:root{--bg:#faf8f5;--fg:#1d1b19;--muted:#6b645c;--line:#e4ded6;--card:#fff;--accent:#b4542d;--ok:#2f6b3a;--no:#9a3412}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#171513;--fg:#eee9e3;--muted:#a69e95;--line:#38332e;--card:#211e1b;--accent:#e08a5e;--ok:#7fc28c;--no:#f0a07a}}
:root[data-theme="dark"]{--bg:#171513;--fg:#eee9e3;--muted:#a69e95;--line:#38332e;--card:#211e1b;--accent:#e08a5e;--ok:#7fc28c;--no:#f0a07a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.8rem;margin:.2em 0}h2{margin-top:2.2em;border-bottom:1px solid var(--line);padding-bottom:.3em}
a{color:var(--accent)}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86em}.muted{color:var(--muted)}
.lede{color:var(--muted);max-width:70ch}.shots,.mails{display:flex;flex-wrap:wrap;gap:20px}
.shot{margin:0;width:390px;max-width:100%}.shot img{width:100%;height:auto;border:1px solid var(--line);border-radius:12px;background:#fff}
.shot figcaption{font-size:.85rem;margin-top:6px;overflow-wrap:anywhere}
.mail{background:var(--card);border:1px solid var(--line);border-radius:12px;width:500px;max-width:100%;overflow:hidden}
.mail header{padding:10px 14px;border-bottom:1px solid var(--line);font-size:.85rem}.mail .k{display:inline-block;width:3.4em;color:var(--muted)}
.mail .subj{font-weight:600;font-size:1rem;margin-top:6px}.mail pre{margin:0;padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:.95rem}
table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.acs td:first-child{width:55%}.test code{overflow-wrap:anywhere}.no{color:var(--no)}.data{display:block;overflow-x:auto}
.story{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:4px 16px 12px;margin:16px 0}
pre.cmd{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto}
nav a{margin-right:12px;white-space:nowrap}
</style></head><body><main>
<p class="muted">calvin · lf-factory-testbed · Epic 4 (calvin-5) · a hand-made showcase, lf-factory idea 19 trial</p>
<h1>Epic 4: check-in and trial data</h1>
<p class="lede">What Epic 4 delivered, from testbed main as it is now. Every screenshot and email below came from the app's own code on seeded local data: the pages from the running app, and the emails from the real plan workflow run on Temporal's time-skipping test server, sent to the test email fake (nothing was sent for real). The example plan is coffee at Blue Bottle, Oakland, Sat 14 Nov 2026 10:00 AM, with Ana, Mia and Raj in.</p>
<nav><a href="#screens">Screens</a><a href="#emails">Emails</a><a href="#stories">Stories and evidence</a><a href="#data">Trial data</a><a href="#run">Run it yourself</a></nav>

<h2 id="screens">Screens</h2>
<h3>The check-in answer (Story 4.6)</h3>
<p class="muted">The creator taps a link in the check-in email; one email takes two taps. Answering again replaces the answer.</p>
<div class="shots">${['checkin-happened-yes', 'checkin-happened-no', 'checkin-attended-no', 'checkin-attended-yes-first', 'checkin-bad-answer'].map(shotFigure).join('\n')}</div>
<h3>Calling it off (Story 4.4)</h3>
<p class="muted">The manage page's call-off. Here every <code>calledOff</code> signal fails, as in Story 4.4: the page still redirects, the plan is called off, and the workflow finds it in the database at the 24h reminder time and sends "Not this time" (below) instead of a reminder.</p>
<div class="shots">${['manage-confirmed', 'manage-called-off', 'checkin-called-off'].map(shotFigure).join('\n')}</div>

<h2 id="emails">Emails</h2>
<p class="muted">As a person gets them: plain text, shown for Mia (a joiner) except the check-in, which goes to Ana (the creator) only. "Sent" is the workflow's own time. Epic 4 added the check-in; the reminders and "Not this time" keep their text, and Epic 4 changed when and whether they go out (4.2–4.4). "It's on" is shown because 4.3 makes it always come before a reminder.</p>
<div class="mails">${shown.map(mailCard).join('\n')}</div>
<p class="muted">Plan A's workflow sent ${mails.filter((m) => m.id.startsWith('a-')).length} emails in all (It's on, Tomorrow and Today to each of Ana, Mia and Raj, then one check-in to Ana); plan C's sent ${mails.filter((m) => m.id.startsWith('c-')).length} ("Not this time" to each of three, and no reminder or check-in).</p>

<h2 id="stories">Stories and evidence</h2>
<p class="muted">Each acceptance criterion next to what shows it. A test name is a test in testbed main's suite (<code>npm test</code>), which passes on main; "not shown" marks what this page can't show.</p>
${storyBlocks}

<h2 id="data">Trial data (Story 4.7)</h2>
<h3 id="events">Plan A's events</h3>
<p class="muted">Times here are when the capture ran: the time-skipping server moves the workflow's clock, not the database's. The workflow's own times are on the emails above.</p>
${table(data.planEvents.map((e) => ({ type: e.type, at: e.at, data: e.data })))}
<h3 id="queries">The trial metric queries, run on this page's data</h3>
<p class="muted">Every query in <code>specs/calvin-5/database-schema.md</code> § Trial metric queries, as written there, against the three plans above (A and B confirmed with check-in answers, C called off by its creator).</p>
${data.queries.map((q) => `<pre class="cmd">${esc(q.sql)}</pre>${table(q.rows)}`).join('\n')}

<h2 id="run">Run it yourself</h2>
<p>From a testbed checkout at main, with Node 26 and Chromium on <code>PATH</code>:</p>
<pre class="cmd">npm ci
npx vitest run --config specs/calvin-5/showcase/vitest.config.ts                    # rebuilds this page
SHOWCASE_SERVE=1 npx vitest run --config specs/calvin-5/showcase/vitest.config.ts   # and keeps the app up on ${BASE}</pre>
<p>The seed is <code>specs/calvin-5/showcase/capture.showcase.ts</code>. It uses an embedded Postgres (the test suite's own setup), the app's own publish and commit code, the real plan workflow on Temporal's time-skipping test server, and the test fakes for email and the AI suggestion: no keys, and no email leaves the machine. It seeds:</p>
<ul>
<li><strong>Plan A</strong>, Ana's example plan, confirmed and run to the end: It's on, both reminders and the check-in. Its check-in link is then answered happened yes, then no, then attended no.</li>
<li><strong>Plan B</strong>, Bea's copy of it, confirmed, answered attended yes first.</li>
<li><strong>Plan C</strong>, Cal's copy, confirmed, called off from the manage page on Thu 12 Nov with every signal failing; the workflow sends "Not this time" at the 24h reminder time.</li>
</ul>
<p>With <code>SHOWCASE_SERVE=1</code> it prints a link to each state. The failure cases (a refused address, a reminder still retrying at the start, a lost signal that later arrives) are in the workflow tests: <code>npx vitest run tests/workflow src/temporal</code>.</p>
</main></body></html>
`;
}
