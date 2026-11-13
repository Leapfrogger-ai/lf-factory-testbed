---
status: accepted
initiative: calvin
supersedes: 0003
decided: the operator, 2026-11-12
---

# One always-on Railway service runs the web server and the Temporal worker in one process

The operator decided this on 2026-11-12. It supersedes [ADR 0003](0003-single-fly-machine.md)'s Fly.io machine, because the operator prefers Railway. The shape doesn't change: one Node process serves the Hono web app and runs the Temporal worker.

calvin is one Railway service, `calvin`, built from the repo's `Dockerfile` (`node:26-bookworm-slim`). It runs 1 replica in `us-east4-eqdc4a` (US East, Virginia), close to calvin's Neon project in `aws-us-east-2` (Ohio), with sleeping off and restart policy `ALWAYS`. The worker has to stay up for timers to fire on time (NFR007), so nothing may scale it to zero. Postgres stays on Neon's Free plan.

- **Migrations** run in Railway's pre-deploy command (`node src/db/migrate.ts`). It runs in the built image before the new version starts, and a failure stops the deploy.
- **Health check**: Railway calls `/healthz` on the new deployment and switches traffic only once it answers 2xx. The app starts listening only after it has connected to Temporal and created the worker, so a deploy that can't reach Temporal never goes live. Railway checks only at deploy time; it doesn't monitor afterwards.
- **Deploys happen on purpose only.** The service deploys from the testbed's `production` branch, never from `main`: during trials, factory story merges land on `main` and would otherwise go straight to users. To deploy, the operator pushes a commit from `main` to `production`. This is simpler than a manual trigger:
  - the branch shows exactly which commit is live;
  - deploying is one `git push`, with no deploy token in GitHub and no CI change;
  - a testbed reset, which force-pushes `main`, can't deploy anything by accident.
- **Rollback** is Railway's rollback to an earlier deployment, which (by Railway's docs) restores its image and variables, with no rebuild. `production` isn't rewound. The fix (or a revert) goes through `main` as usual, and the next push to `production` deploys it. Until then, `production` names the rolled-back commit, not the live one.
- **The settings are code**, in `.railway/railway.ts` (Railway's Infrastructure as Code, `railway` SDK 3.16.0). The operator applies it with `railway config apply`, and CI never does. Railway's older `railway.json`/`railway.toml` (Config as Code) is deprecated, new services can't use it, and it stops working on 2026-12-01. `partial = "calvin"` limits an apply to this service. Secrets are declared with `preserve()` and set as sealed variables in Railway's dashboard, so no value is ever in the repo.

**Region (amended 2026-11-13).** The service first ran in US West (`us-west2`), next to a Neon project in `aws-us-west-2`. The operator then chose an existing Neon project for calvin, which is in `aws-us-east-2`, and Neon can't move a project between regions. With the app in US West, every query would cross the country (about 60 ms each, several per page). In US East the database is about 10 ms away, and a Bay Area visitor pays one cross-country round trip per page instead. calvin's Temporal namespace is created in an AWS us-east region for the same reason.

## Considered Options

- **Fly.io, one machine** (ADR 0003): the same shape, but the operator prefers Railway.
- **Autodeploy from `main` with "wait for CI"**: every story merge would reach trial users.
- **Autodeploy off, with "Deploy Latest Commit" from `main`**: deploys whatever `main` holds at that moment, including a story the operator hasn't tried, or an empty repo right after a testbed reset.
- **A GitHub Actions `workflow_dispatch` job running `railway up`**: needs a Railway token in GitHub and a CI change, for the same result as a branch push.
- **A second service for the worker**: two services to deploy and pay for, at a 3–5-plan trial.
- **`railway.json` (Config as Code)**: deprecated, closed to new services, and gone on 2026-12-01.

## Consequences

- No redundancy, as in ADR 0003: a crash pauses timers and pages briefly. Timers fire late rather than being lost. On a deploy, the old version keeps running until the new one passes its health check, then gets `drainingSeconds: 30` between SIGTERM and SIGKILL to stop the worker cleanly. In-flight activities are cancelled at SIGTERM (the worker's `shutdownGraceTime` is 0), and Temporal retries them on the new worker. The send ledger keeps each email to one send.
- Old and new versions overlap briefly, so a migration must not break the running version (add, then remove later). The pre-deploy command runs before the new version starts.
- The `production` branch lives in the testbed. A testbed reset must keep it. After a reset, `production` is moved to new `main` commits with a merge commit, not a force-push (runbook, "After a testbed reset").
- calvin's rate limits key on Railway's `X-Real-IP` header instead of Fly's `Fly-Client-IP`. Railway passes a client's own `Fly-Client-IP` through, so trusting it would let anyone reset their limit.
- Cost: Railway's Hobby plan plus usage, under the ~$20/month target (NFR010). Nothing here was checked against Railway's pricing; the operator confirms it.
