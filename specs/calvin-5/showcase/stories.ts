// Epic 4's stories (specs/calvin-5/epics.md), each acceptance criterion with what shows it on the showcase.
type Evidence =
  | { shot: string }
  | { mail: string; to?: string }
  | { test: string }
  | { db: string; label: string }
  | { notShown: string };
type Story = { id: string; title: string; summary: string; acs: { text: string; evidence: Evidence[] }[] };

const WF = 'tests/workflow/plan-workflow.test.ts';
const ACT = 'src/temporal/activities.test.ts';
const CHECKIN = 'src/web/routes/check-in.test.ts';
const MANAGE = 'src/web/routes/manage.test.ts';
const METRICS = 'tests/trial-metrics.test.ts';
const t = (file: string, name: string): Evidence => ({ test: `${file} › ${name}` });
const internal = { notShown: 'internal behaviour with no screen or email of its own; the test is the evidence' };

export const STORIES: Story[] = [
  {
    id: '4.1',
    title: 'Every patched() id has its own replay test',
    summary: 'A source guardrail now matches workflow patches to replay tests by id, not by count.',
    acs: [
      {
        text: 'On main the guardrail passes, and each patched() id is named by a workflow test that replays a history.',
        evidence: [
          t('tests/guardrails-source.test.ts', 'every patched() id in the plan workflow has a recorded-history replay test'),
          internal,
        ],
      },
      {
        text: "A new patched('example-x') with no replay test fails the guardrail, naming example-x.",
        evidence: [t('tests/patched-ids.test.ts', 'a patched id no replay test names is a problem')],
      },
      {
        text: 'Two tests naming reminders-3-3 and none naming call-off-3-5 fails, naming call-off-3-5.',
        evidence: [t('tests/patched-ids.test.ts', 'several tests naming one id leave only the unnamed id as a problem')],
      },
      {
        text: "Each id's replay test replays a history recorded before that patch without a nondeterminism error.",
        evidence: [
          t(WF, 'replays a history recorded before confirmed-emails-3-2'),
          t(WF, 'replays a history recorded before reminders-3-3'),
          t(WF, 'replays a history recorded before call-off-3-5'),
        ],
      },
    ],
  },
  {
    id: '4.2',
    title: "One failed send doesn't stop the others",
    summary: "A refused address skips that one committer; everyone else still gets their email, and the workflow carries on.",
    acs: [
      {
        text: "Mia's sends are refused: Ana and Raj get one confirmation each, Mia's ledger row stays unsent, and an error line names the plan, kind and error, with no address or token.",
        evidence: [t(ACT, 'skips Mia, sends Ann and Raj once each, and logs the failure'), { notShown: 'the showcase runs the happy path; a refused send has no screen' }],
      },
      {
        text: 'That plan still sends Ana and Raj both reminders, and the workflow keeps running.',
        evidence: [t(WF, "carries on to the reminders when one committer's address is refused (AC2)")],
      },
      {
        text: 'A send to Mia that fails once and then succeeds: each of the three gets exactly one confirmation.',
        evidence: [t(WF, 'sends each committer exactly one confirmation when a send to Mia fails once and is retried (AC3)')],
      },
      {
        text: "A late commit by Lee whose send is refused: the workflow keeps running and the next reminder reaches everyone else.",
        evidence: [t(WF, 'a late commit whose send is refused leaves the workflow running and the next reminder reaches everyone else (AC4)')],
      },
      {
        text: '"Not this time" at the deadline with Mia refused: every other active committer gets it once.',
        evidence: [t(WF, 'sends Not this time to every other committer when the send to Mia is refused (AC5)')],
      },
    ],
  },
  {
    id: '4.3',
    title: 'Reminders that arrive in time and in order',
    summary: 'A reminder still unsent when the gathering starts is dropped, and nobody gets a reminder before their "It\'s on".',
    acs: [
      {
        text: 'Every morning reminder send fails until 10:30 AM: no morning reminder goes out, and the workflow goes on to its check-in time.',
        evidence: [t(WF, 'drops the morning reminder that is still retrying when the gathering starts (AC1)')],
      },
      {
        text: "Ana's morning reminder goes at 8:00 AM, Raj's send fails until 10:05 AM: Raj gets none, Ana exactly one.",
        evidence: [t(WF, "drops Raj's morning reminder when his send is still failing at 10:05 AM, and Ann keeps hers (AC2)")],
      },
      {
        text: "Lee commits while the 24h reminder is retrying: his first email is \"It's on\", and any \"Tomorrow:\" comes after it.",
        evidence: [
          t(WF, "gives Lee his It's on email before any reminder when he commits while the 24h reminder is retrying (AC3)"),
          { mail: "It's on", to: 'mia.ana@example.test' },
        ],
      },
      {
        text: 'With no failures, the reminders go at the same instants as before (Fri 13 Nov 10:00 AM and Sat 14 Nov 8:00 AM Pacific) with the same text.',
        evidence: [
          t(WF, 'sends the reminders at the example instants with the same text (AC4)'),
          { mail: 'Tomorrow', to: 'mia.ana@example.test' },
          { mail: 'Today', to: 'mia.ana@example.test' },
        ],
      },
    ],
  },
  {
    id: '4.4',
    title: 'A call-off always sends "Not this time"',
    summary: 'The workflow checks the database before each reminder and the check-in, so a lost calledOff signal no longer means reminders for a cancelled plan.',
    acs: [
      {
        text: 'Confirmed, called off on Thu 12 Nov, every signal fails: at the 24h reminder time everyone gets "Not this time" once, nobody gets a reminder, and the workflow ends.',
        evidence: [
          t(WF, 'sends Not this time once each at the 24h reminder time when no signal arrived, and no reminder (AC1)'),
          { shot: 'manage-confirmed' },
          { shot: 'manage-called-off' },
          { mail: 'Not this time', to: 'mia.cal@example.test' },
        ],
      },
      {
        text: 'That plan: Ana gets no check-in email.',
        evidence: [t(WF, 'sends Ana no check-in email when no signal arrived (AC2)'), { notShown: 'an email that is not sent; plan C\'s mail count above shows none' }],
      },
      {
        text: 'A signal that fails twice then succeeds: the workflow gets it, "Not this time" goes once to each, and no error is logged.',
        evidence: [t(MANAGE, 'tries again and logs nothing when the signal fails twice and then succeeds (AC3)')],
      },
      {
        text: 'A signal that always fails: still 303 to /m/<manageToken>, the plan is called off, and one error "plan signal failed" names the plan id and calledOff.',
        evidence: [
          t(MANAGE, 'makes three attempts, then logs one error naming the plan and calledOff (AC4)'),
          { shot: 'manage-called-off' },
        ],
      },
      {
        text: 'A call-off whose signal did arrive: "Not this time" still goes exactly once to each.',
        evidence: [t(WF, 'sends Not this time exactly once each when the signal arrived and the plan is called off in Postgres (AC5)')],
      },
    ],
  },
  {
    id: '4.5',
    title: 'The check-in email',
    summary: 'The day after a confirmed gathering, at 10:00, the creator alone is asked whether it happened and whether they were there.',
    acs: [
      {
        text: 'At 2026-11-15T18:00Z Ana gets one "Did it happen? Coffee on Sat 14 Nov" email with the exact body, an email.sent event with kind check_in is recorded, nobody else gets one, and the workflow completes.',
        evidence: [t(WF, 'sends Ana one check-in at the check-in time and ends (AC1, AC5)'), { mail: 'Did it happen?' }, { db: 'events', label: "plan A's events" }],
      },
      {
        text: 'The check-in has no /w/ URL and no other committer\'s name.',
        evidence: [t('src/email/templates.test.ts', "has no withdraw URL and no other committer name (AC2)"), { mail: 'Did it happen?' }],
      },
      {
        text: 'A plan called off at its deadline gets no check-in.',
        evidence: [t(WF, 'sends no check-in to a plan called off at its deadline (AC3)')],
      },
      {
        text: 'A first check-in send that fails retryably: Ana still gets exactly one.',
        evidence: [t(WF, 'a first check-in send that fails retryably is retried and Ana still gets one email (AC4)')],
      },
      {
        text: 'Someone who commits after the 24h reminder: only Ana gets the check-in.',
        evidence: [t(WF, 'sends the check-in to Ana only when a committer joined after the 24h reminder (AC5)')],
      },
      {
        text: "A history recorded by calvin-4's workflow replays without a nondeterminism error.",
        evidence: [t(WF, 'replays a history recorded before check-in-4-5')],
      },
    ],
  },
  {
    id: '4.6',
    title: 'Answer the check-in',
    summary: 'One tap answers a question; the thank-you page offers the other one, and tapping again changes the answer.',
    acs: [
      {
        text: 'happened/yes: 200, "Thanks! Got it: it happened.", the answer and one check_in.answered event stored, and "Were you there?" with Yes and No links.',
        evidence: [t(CHECKIN, 'records happened/yes and offers the attended question (AC1)'), { shot: 'checkin-happened-yes' }],
      },
      {
        text: 'Then happened/no: the answer becomes false, a second event is recorded, and the page reads "Thanks! Got it: it didn\'t happen."',
        evidence: [t(CHECKIN, 'replaces an earlier answer (AC2)'), { shot: 'checkin-happened-no' }],
      },
      {
        text: 'Both answered, then attended/no: "Thanks! Got it: you weren\'t there." and no other question.',
        evidence: [t(CHECKIN, 'shows no other question once both are answered (AC3)'), { shot: 'checkin-attended-no' }],
      },
      {
        text: 'attended/yes first: "Thanks! Got it: you were there." and "Did it happen?" with its two links.',
        evidence: [t(CHECKIN, 'offers happened after attended/yes first (AC4)'), { shot: 'checkin-attended-yes-first' }],
      },
      {
        text: 'A called-off plan, an unknown or malformed token, the question maybe or the answer perhaps: the same 404 not-found page, and nothing written.',
        evidence: [
          t(CHECKIN, 'answers 404 and records nothing for %s (AC5)'),
          t(CHECKIN, 'a malformed link is 404 without a database query (AC5)'),
          { shot: 'checkin-called-off' },
          { shot: 'checkin-bad-answer' },
        ],
      },
      {
        text: 'Every thank-you page carries noindex, generic OG tags, and no email address or other committer\'s name.',
        evidence: [t(CHECKIN, 'is noindex, has generic OG tags and leaks no email or committer name (AC6)'), { notShown: 'page head tags aren\'t visible in a screenshot' }],
      },
    ],
  },
  {
    id: '4.7',
    title: 'The trial metrics run',
    summary: 'The schema document\'s trial metric queries are proven against the real schema, on data the app itself wrote.',
    acs: [
      {
        text: 'Two plans, one shared and one creator-only: share rate 0.5.',
        evidence: [t(METRICS, 'share rate is 0.5 for one shared plan and one creator-only plan (AC1)'), { db: 'queries', label: 'the queries on this page\'s data' }],
      },
      {
        text: 'The outcomes query shows the confirmed plan\'s answers and the called-off plan\'s reason.',
        evidence: [t(METRICS, 'outcomes: a confirmed plan with answers, then a plan called off at its deadline (AC2)'), { db: 'queries', label: 'the outcomes query on this page\'s data' }],
      },
      {
        text: 'One unchanged and one edited published suggestion: edited rate 0.5.',
        evidence: [t(METRICS, 'edited rate is 0.5 for one unchanged and one edited published suggestion (AC3)'), { notShown: 'this page\'s plans weren\'t published from a suggestion' }],
      },
      {
        text: 'The emails-per-kind query matches the emails sent.',
        evidence: [t(METRICS, 'emails per kind match the emails sent (AC4)'), { db: 'queries', label: 'emails per kind on this page\'s data' }],
      },
      {
        text: 'No query in the section fails.',
        evidence: [t(METRICS, 'runs every query in the Trial metric queries section without error'), { db: 'queries', label: 'all queries, run here' }],
      },
      {
        text: "A plan's life lists one event each of plan.published, commit.added, plan.confirmed, email.sent and check_in.answered, each with a timestamp.",
        evidence: [t(METRICS, "lists one event of each type over a plan's life, each with a timestamp (AC6)"), { db: 'events', label: "plan A's events" }],
      },
    ],
  },
];
