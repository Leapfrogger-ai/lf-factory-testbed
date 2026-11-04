# Temporal TypeScript SDK + Temporal Cloud for calvin plan workflows

## Question

For calvin (one Temporal Workflow per plan on Temporal Cloud, driven by a Hono/Node web server), which native Temporal features cover deadline waiting, commit/withdraw/call-off events with a synchronous answer, scheduled emails sent exactly once, deterministic LA-local scheduling, code changes to running plans, Cloud connection, testing, history limits and cost — and what are their limits at the current SDK version?

## Answer in one sentence

Use the TypeScript SDK 1.24.0 with Update-with-Start / Updates for commit/withdraw/call-off (GA on server and not marked experimental in the SDK), durable timers via `condition(fn, timeout)` / `sleep` for deadline and reminders, Queries for page reads, Activities with an idempotency key (Workflow Id + Activity Id, or plan+committer+email-kind) passed to Resend for exactly-once-in-effect email, plan id as Workflow Id with the default `FAIL` conflict policy for creation, `patched()` for code changes, `@temporalio/envconfig` + `TEMPORAL_ADDRESS/NAMESPACE/API_KEY` for Cloud, and compute all LA wall-clock instants as UTC epoch ms outside the Workflow (or deterministically from input) rather than relying on `Intl` time-zone data inside the sandbox.

## Versions

Checked 2026-10-27.

- npm `latest` dist-tag: `@temporalio/client`, `worker`, `workflow`, `activity`, `testing`, `envconfig`, `common` = **1.24.0** (published 2026-09-15). Source read from the npm tarballs.
- Temporal Server release notes (primary, via docs retrieval): Workflow Update GA in v1.26.2; Update-With-Start GA in v1.28.0; Worker Versioning GA in v1.31.0.
- Temporal Cloud docs (limits, actions, pricing) as published on 2026-10-27.

---

## Timers (`sleep`, `condition` with timeout)

**What it is.** `sleep(ms)` schedules a durable Timer on the Temporal Service; `condition(fn, timeout)` races a Timer against a predicate re-evaluated after every signal/update, returning `true` if the predicate became true, `false` on timeout. There is no "sleep until absolute time" API: compute `deadlineMs - Date.now()` inside the workflow (workflow `Date.now()` is deterministic, see Sandbox).

**Replaces.** A cron/poller table of due jobs plus a scheduler process that must survive restarts.

**Limits at 1.24.0.**
- Durations are relative ms or `ms`-format strings; `<= 0` is coerced to 1 ms.
- Timers survive Worker and Service downtime and fire when things come back up — lateness is bounded by your Worker being up, not by Temporal.
- No precision guarantee is documented. Server caps proto durations at 100 years.
- Every `condition(..., timeout)` call starts a new Timer (a billable Action). A loop that re-arms after each event costs one Timer per event.

**Sources.**
- SDK source `workflow/src/workflow.ts` (1.24.0), `sleep`: "Schedules a timer on the Temporal service." / "If given a negative number or 0, value will be set to 1." `condition`: "@returns a boolean indicating whether the condition was true before the timeout expires".
- [Timers – TypeScript](https://docs.temporal.io/develop/typescript/workflows/timers): "Timers are persisted, so even if your Worker or Temporal Service is down when the time period completes" … "as soon as your Worker and Temporal Service are back up"; "A Workflow can sleep for months."
- [Server v1.28.0 release notes](https://github.com/temporalio/temporal/releases/tag/v1.28.0): "Proto durations will now automatically be capped to 100 years."

## Workflow message passing: Signals, Updates, Queries, Signal-With-Start, Update-With-Start

**What it is.**
- A **Signal** is an async write: fire-and-forget, with no result.
- An **Update** is a synchronous, tracked write that returns a result or error. It can have a synchronous **validator** that rejects before anything is written to history.
- A **Query** is a synchronous read. Its handler cannot be async and must not mutate state.
- **Update-With-Start** (`client.workflow.executeUpdateWithStart` + `WithStartWorkflowOperation`) starts the workflow if it doesn't exist and delivers the Update.
- **Signal-With-Start** does the same with a Signal, and it is atomic.

**Replaces.** A request/response table plus polling ("did my commit confirm the plan?"), and hand-rolled "create if missing, then mutate" logic.

**Choice for calvin.** Use an **Update** for commit / withdraw / call-off. The handler mutates state and returns e.g. `{ status: 'committed', confirmedNow: true, count }`, and a validator rejects commits after the deadline or on a called-off plan. Pass an Update ID (e.g. a request id) so a retried HTTP request is deduplicated. Plan creation is a normal `start` with Workflow Id = plan id. Use Update-With-Start only if "create + first commit" must be one round trip. Use a **Query** for page reads.

**Limits.**
- An Update needs a live Worker: the client blocks (and retries indefinitely) until a Worker accepts it. A Signal doesn't.
- Temporal Cloud allows at most 10 in-flight Updates and 2,000 total Updates per execution, and 10,000 Signals per execution.
- Update-With-Start requires an explicit `workflowIdConflictPolicy` and is not atomic.
- Queries work on closed workflows only within the retention period, and only while a Worker is polling.
- SDK 1.24.0 marks only the `typeInfo`/`*WithOptions` additions `@experimental`, not `executeUpdate` / `executeUpdateWithStart`.

**Sources.**
- [Workflow message passing – encyclopedia](https://docs.temporal.io/encyclopedia/workflow-message-passing): "Updates are synchronous, tracked write requests."; "Use an Update for synchronous read/write requests."; "Unlike Signals, Updates must be synchronous and must wait for the Worker running the Workflow to acknowledge the request."
- [Message passing – TypeScript](https://docs.temporal.io/develop/typescript/workflows/message-passing): "Use validators to reject an Update before it is written to History."; "A Query handler cannot be `async`."; "You can send Queries to closed Workflow Executions within a Namespace's Workflow retention period."; "You must specify a WorkflowIdConflictPolicy when creating the `WithStartWorkflowOperation`."; "Remember: handlers can execute before the main Workflow method starts."
- [Sending messages](https://docs.temporal.io/sending-messages): "Unlike Signal-with-Start - Update-With-Start is _not_ atomic."
- [Temporal Cloud limits](https://docs.temporal.io/cloud/limits): "A single Workflow Execution can have a maximum of 10 in-flight Updates and 2000 total Updates in History."; "A single Workflow Execution may receive up to 10,000 Signals."
- GA status, from primary server release notes surfaced by the docs retrieval API: [v1.26.2](https://github.com/temporalio/temporal/releases/tag/v1.26.2) "## Workflow Update GA"; [v1.28.0](https://github.com/temporalio/temporal/releases/tag/v1.28.0) "#### Update-With-Start GA".
- Caveat: the TypeScript and Cloud doc pages themselves state no release stage for Update. The Ruby page still shows a "Public Preview in Temporal Cloud" badge on Update-With-Start, so docs are inconsistent across SDK pages. Plain Update is unambiguous.

## Workflow Id, Workflow Id Reuse Policy, Workflow Id Conflict Policy

**What it is.**
- A Workflow Id is unique among *open* executions in a Namespace.
- The **Reuse Policy** governs reuse after close. Values: Allow Duplicate, Allow Duplicate Failed Only, Reject Duplicate, Terminate if Running. It is checked only against closed runs still within retention.
- The **Conflict Policy** governs a start against an *open* run. Values: Fail (default), Use Existing, Terminate Existing.

**Replaces.** A unique constraint and dedupe logic for "one workflow per plan".

**Limits.** Ids can be at most 1,000 bytes. Reuse checks only reach back as far as retention (30 days by default).

**Sources.**
- [Workflow Id and Run Id](https://docs.temporal.io/workflow-execution/workflowid-runid): "Temporal guarantees that there can be at most one Workflow Execution with a given ID running at any point in time"; "**Fail:** Prevents the Workflow Execution from spawning and returns a `Workflow execution already started` error. **This is the default policy, if one isn't specified.**"; "**Use Existing:** Prevents the Workflow Execution from spawning and returns a successful response with the Open Workflow Execution's Run Id."; "the Temporal Service can only check the Workflow Id of the spawning Workflow Execution based on the Workflow Id Reuse Policy against the Closed Workflow Executions for the last _30 days_."
- [Cloud limits](https://docs.temporal.io/cloud/limits): "Identifiers, such as Workflow Id, Workflow Type, and Task Queue names, are limited to a maximum length of 1,000 bytes."

## Activities: Retry Policy, timeouts, Heartbeats, idempotency

**What it is.**
- Activities run side effects (the Resend call) and are retried by default: initial interval 1 s, backoff 2.0, max interval 100 × initial, **unlimited attempts**.
- Each Activity must set Start-To-Close or Schedule-To-Close.
- Heartbeats let a long Activity report liveness. They are irrelevant for a single HTTP call.
- Execution is **at least once**: a Worker crash after Resend succeeds but before completion is recorded causes a retry.

**Replaces.** An outbox table, retry loop and "sent" flags.

**Implication for exactly-once email.**
- Temporal cannot by itself guarantee exactly-once delivery. The docs say idempotency is "enforced by the service you are calling".
- Pass a deterministic idempotency key to Resend. Docs suggest Workflow Run Id + Activity Id. For calvin, `planId:committerId:emailKind` is stable even across Continue-As-New or a reset.
- Completed Activities are not re-executed on replay, so Worker restarts alone never resend.
- Set `maximumAttempts` / Schedule-To-Close so a permanently failing send does not retry forever. Check the key window in research/resend.md.

**Sources.**
- [Retry Policies](https://docs.temporal.io/encyclopedia/retry-policies): "Initial Interval = 1 second / Backoff Coefficient = 2.0 / Maximum Interval = 100 × Initial Interval / Maximum Attempts = ∞".
- [Activity timeouts – TypeScript](https://docs.temporal.io/develop/typescript/activities/timeouts): "An Activity Execution must have either the Start-To-Close or the Schedule-To-Close Timeout set."; "If the Temporal Service does not receive a Heartbeat within a Heartbeat Timeout time period, the Activity will be considered as timed out".
- [Activity Definition – Idempotency](https://docs.temporal.io/activity-definition): "The Activity function completes successfully, but the Worker crashes just before it notifies the Temporal Service. In this case, the Event History won't reflect the successful completion of the Task, so the Activity will be retried."; "These are enforced by the service you are calling from your Activity, not by the Activity itself."; "You can use a combination of the Workflow Run ID and the Activity ID as an idempotency key"; "By design, completed Activities will not re-execute as part of a Workflow Replay."
- [Activity basics – TypeScript](https://docs.temporal.io/develop/typescript/activities/basics): "Activities may be retried repeatedly, so you may need to use idempotency keys for critical side effects."

## Workflow sandbox / deterministic constraints

**What it is.**
- Workflow code is Webpack-bundled and run in a V8 `vm` context.
- `Date`, `Date.now()`, `Math.random()` and `setTimeout` are replaced with deterministic versions. `Date.now()` returns the time of the last Workflow Task and advances only across `await`s.
- `WeakRef` and `FinalizationRegistry` are removed. Node and DOM APIs are unavailable, and `crypto.randomUUID()` is absent; use `uuid4()`.

**Replaces.** Nothing to hand-roll. It is the constraint you design around.

**Time zones / `Intl`.**
- The docs say nothing about `Intl`.
- SDK 1.24.0 source overrides only `Date` (`global-overrides.ts`). It does not touch or remove `Intl`, and the sandbox is a plain `vm.createContext({})`, so V8's built-in `Intl` (backed by the Worker's Node ICU/tzdata) is present. I could not run Node here to confirm.
- This is not a documented guarantee. Results would depend on the Worker's Node ICU tz version, which can change between deploys and break replay if a DST rule changes.
- Recommendation: compute the LA-local instants as UTC epoch ms when the plan is created, in the web server or an Activity whose result is recorded in history. Use a tz library there, pass them as workflow input, and keep the workflow arithmetic pure: deadline, D-1 24h, 08:00 on the day, 10:00 next day.

**Sources.**
- [Workflow basics – TypeScript](https://docs.temporal.io/develop/typescript/workflows/basics): "Workflows run in a deterministic sandboxed environment. The code is bundled on Worker creation using Webpack, and can import any package as long as it does not reference Node.js or DOM APIs."; "functions like `Math.random()`, `Date`, and `setTimeout()` are replaced by deterministic versions."; "`Date.now()` and `new Date()` are replaced by deterministic versions that return the time of the last Workflow Task completion."; "Avoid `crypto.randomUUID()`, which is not available in the sandbox".
- SDK source `workflow/src/global-overrides.ts` (1.24.0): `const OriginalDate = globalThis.Date;` … `return new OriginalDate(getActivator().now);`. There is no `Intl` reference anywhere in `workflow/src` or `worker/src`. `worker/src/workflow/vm.ts`: `vm.createContext({}, { microtaskMode: 'afterEvaluate' })`.

## Versioning (Patching: `patched` / `deprecatePatch`; Worker Versioning)

**What it is.**
- `patched(id)` branches new and old code paths and writes a marker into history.
- `deprecatePatch(id)` is the bridge step. Remove it once no pre-patch runs remain.
- **Worker Versioning** (Worker Deployments with Pinned/Auto-Upgrade behaviour) is GA as of server v1.31. It lets you pin workflows to a build instead of patching. The pre-2025 experimental Worker Versioning was scheduled for removal in March 2026.

**Replaces.** Hand-written "schema version" fields and migration branches in workflow state.

**Minimal PoC practice.**
- Plans live days to weeks. Any change that adds, removes or reorders `await`ed timers or activities needs `patched()`.
- Alternatively, drain or terminate the 3–5 trial plans before deploying.
- Add a replay test (`Worker.runReplayHistories`) against exported histories.
- Skip Worker Versioning for the PoC: it needs deployment-pipeline wiring.

**Sources.**
- [Versioning – TypeScript](https://docs.temporal.io/develop/typescript/workflows/versioning): "Common causes include adding, removing, or reordering `await` calls on Command-producing APIs such as Activities and timers."; "Using `patched` inserts a marker into the Event History."; "Deprecated patches serve as a bridge … However, this marker won't cause a replay failure when the Workflow code doesn't produce it."; "Support for the experimental Worker Versioning method before 2025 was scheduled for removal from Temporal Server in March 2026."
- [Worker Versioning](https://docs.temporal.io/worker-versioning): "A **Pinned** Workflow is guaranteed to complete on a single Worker Deployment Version."
- [Server v1.31.0 release notes](https://github.com/temporalio/temporal/releases/tag/v1.31.0): "### Worker Versioning GA".

## Temporal Client connection to Temporal Cloud (API key / mTLS, Environment configuration)

**What it is.**
- Cloud accepts an API key or mTLS. The recommended endpoint is the namespace endpoint `<namespace>.<account>.tmprl.cloud:7233`, with `tls: true`, `apiKey`, and `namespace: <namespace_id>.<account_id>`.
- `@temporalio/envconfig` 1.24.0 provides `loadClientConnectConfig()`. It reads `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY`, `TEMPORAL_TLS*`, `TEMPORAL_PROFILE`, `TEMPORAL_CONFIG_FILE`, `TEMPORAL_CODEC_*` and `TEMPORAL_GRPC_META_*` (verified in source).
- It also reads an optional `temporal.toml` profile. Env vars take precedence over the file.

**Replaces.** Bespoke config parsing and cert handling.

**Limits.** Cloud namespace defaults to 500 actions/s. Payloads are limited to 2 MB per request and 4 MB per history transaction.

**Sources.**
- [Temporal Client – TypeScript](https://docs.temporal.io/develop/typescript/client/temporal-client): "You can connect to Temporal Cloud using either an API key or through mTLS."; "The recommended endpoint is the gRPC Namespace endpoint: `<namespace>.<account>.tmprl.cloud:7233`."; "`TEMPORAL_API_KEY`: Your API key value. Required if you are using API key authentication."; "The `loadClientConnectConfig` function will automatically load all environment variables."; "The connection options set in configuration files have lower precedence than environment variables."
- [Cloud limits](https://docs.temporal.io/cloud/limits): "Default limit: 500 actions per second (APS)."; "The max payload for a single request is 2 MB."

## Testing (`TestWorkflowEnvironment`, time skipping, Temporal CLI dev server)

**What it is.**
- `TestWorkflowEnvironment.createTimeSkipping()` runs the Java-based test server. It fast-forwards timers while awaiting a result, and you can skip manually with `env.sleep()`.
- `createLocal()` runs the Temporal CLI dev server, which has full features but no time skipping.
- `temporal server start-dev` serves gRPC on localhost:7233 and the UI on :8233 with an in-memory DB.

**Replaces.** Fake clocks and a hand-built scheduler harness.

**Limits.**
- Time skipping is global to the environment, so run tests serially.
- The test server "does not support full capabilities" of the real server. Verify Update/Update-With-Start behaviour there or fall back to `createLocal`.
- The test server is not supported on ARM (Rosetta works on Apple silicon).

**Sources.**
- SDK source `testing/src/testing-workflow-environment.ts` (1.24.0): "Note that the Time Skipping Test Server does not support full capabilities of the regular Temporal Server … For general Workflow testing, it is generally preferable to use createLocal"; "At this time, the Time Skipping Test Server is not supported on ARM platforms."
- [Testing – TypeScript](https://docs.temporal.io/develop/typescript/best-practices/testing-suite): "In \"skipped\" mode, timers (`sleep()` calls and `condition()` timeouts) are fast-forwarded except when Activities are running."; "Time is a global property of an instance of `TestWorkflowEnvironment`".
- [Local setup – TypeScript](https://docs.temporal.io/develop/typescript/set-up-your-local-typescript): "uses an in-memory database."; "The Temporal Service will be available on localhost:7233. The Temporal Web UI will be available at http://localhost:8233."

## Event History limits / Continue-As-New

**What it is.** History is capped at 51,200 events or 50 MB, with a warning at 10,240 events or 10 MB. Continue-As-New restarts the run with fresh history under the same Workflow Id, and `workflowInfo().continueAsNewSuggested` tells you when.

**Relevance.** None at this volume. A plan with tens of committers produces hundreds of events at most. Don't implement Continue-As-New.

**Sources.**
- [Cloud limits](https://docs.temporal.io/cloud/limits): "a Workflow Execution's Event History is limited to 51,200 Events or 50 MB."; "It warns you after 10,240 Events or 10 MB."
- [Continue-As-New – TypeScript](https://docs.temporal.io/develop/typescript/workflows/continue-as-new): "Call `wf.workflowInfo().continueAsNewSuggested` to check if it's time."

## Actions (Temporal Cloud pricing unit)

**Counting rules (documented).** Each of the following is one Action:
- workflow start;
- each Timer, including implicit timeout timers;
- each Signal, and Signal-With-Start counts once;
- each Query, including viewing the call stack in the Cloud UI;
- each Update; Update-With-Start adds its start, and deduplicated Update IDs are free;
- each Activity start and each retry;
- a Heartbeat only if it reaches the server.

Price starts at $50 per million Actions.

**Rough per-plan estimate** (my arithmetic from those rules, for N committers):
- 1 start
- ~4 timers: deadline, two reminders, check-in, plus one per re-armed `condition` timeout
- ~N commits and withdrawals, as Updates
- ~3N + a few email Activities
- 1 Query per page view

For N = 6 with 50 page views that is about 100 Actions per plan, so cost is negligible.

**Sources.**
- [Actions](https://docs.temporal.io/cloud/actions): "Includes implicit Timers that are started by a Temporal SDK when timeouts are set"; "De-duplicated Updates that share an Update ID do not count as an Action."; "Occurs each time a Workflow Activity or Standalone Activity is started or retried."; "A Heartbeat call from Activity code counts as an Action only if it reaches the Temporal Server."
- [Pricing](https://docs.temporal.io/cloud/pricing): "Actions pricing starts at $50 per million Actions ($0.00005 per Action)."

---

## Implications for calvin

- Pin `@temporalio/*` to exactly **1.24.0**, all packages at the same version.
- Start one workflow per plan with `workflowId = planId` and the default `FAIL` conflict policy. A duplicate create returns "already started", which maps to 409.
- Model commit, withdraw and call-off as **Updates**:
  - Each has a validator that rejects after the deadline or once the plan is called off.
  - Commit returns `{ confirmedNow, count }`.
  - Send an Update ID derived from the request for dedupe.
  - Read pages through a **Query**, or through a DB projection if Worker downtime must not break page reads (Updates and Queries both need a live Worker).
- Main loop: `await condition(() => calledOff || confirmed, deadlineMs - Date.now())`. Then `sleep` until each reminder/check-in instant, skipping instants already past.
  - The 5-minute SLA holds as long as a Worker is running. Worker uptime, not Temporal, is the risk.
- Compute every LA-local instant (deadline, D-1 24h, 08:00 day-of, 10:00 next day) as UTC epoch ms in the web server at plan creation, and pass them as workflow input. Don't depend on `Intl` time zones inside the sandbox.
- One Activity per email per committer. Pass Resend an idempotency key of `planId:committerId:kind`, and set bounded `maximumAttempts` / `scheduleToCloseTimeout`. Exactly-once comes from the key, not from Temporal (see research/resend.md for the key window).
- Connect with `@temporalio/envconfig` `loadClientConnectConfig()`, using env vars `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` and `TEMPORAL_API_KEY` (API key auth, no mTLS). The web server and the Worker share them.
- Versioning: use `patched()` for any change to the timer or activity sequence while plans are live, and add one replay test. Skip Worker Versioning and Continue-As-New.
- Tests: use `createTimeSkipping()` for deadline and reminder flows, `createLocal()` for Update-With-Start or edge cases, and `temporal server start-dev` for local development.
