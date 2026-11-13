# Deploying calvin (operator runbook)

calvin runs as one always-on Railway service, built from `Dockerfile` and configured in `.railway/railway.ts` ([ADR 0006](adr/0006-single-railway-service.md)). Only a push to the `production` branch deploys it. Merges to `main` never do.

Everything here is the operator's to do. No step needs a secret in the repo, a command line or CI.

## 1. Accounts and secrets (once)

| Service | What to set up | Gives you |
|---|---|---|
| Railway | An account on the Hobby plan; an empty project named `calvin`; Railway's GitHub app with access to `Leapfrogger-ai/lf-factory-testbed`. Confirm the plan's price and included usage keep calvin under ~$20/month (NFR010). | The service, logs, HTTPS |
| Neon | calvin's existing Neon project, with one database. Take the **direct** connection string (not `-pooler`), with `sslmode=require`. | `DATABASE_URL` |
| Temporal Cloud | A namespace for calvin only, created in an AWS us-east region (near the app and the database). An API key (through a service account) that can reach that namespace and nothing else. | `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY` |
| Anthropic | A workspace of its own for calvin, with a monthly spend limit. A key from that workspace. | `ANTHROPIC_API_KEY` |
| Resend | Add and verify the `send.<domain>` subdomain (its DNS records). An API key with sending access only, restricted to that domain. | `RESEND_API_KEY`, `EMAIL_FROM` |
| Domain | calvin's domain, such as `calvin.example.com`. Its DNS gets a CNAME to Railway in step 3. | `CALVIN_DOMAIN`, and `BASE_URL` from it |
| GitHub | A ruleset on the testbed's `production` branch: only you may push, with no force-push and no deletion. Tell whoever resets the testbed to keep `production` (and see "After a testbed reset" below). | Deploys only on purpose |

Everything runs in the US East: Railway's US East region (`us-east4-eqdc4a`, Virginia), Neon's `aws-us-east-2` (Ohio), where calvin's existing project already is, and the Temporal namespace in an AWS us-east region. Neon can't move a project between regions, so the app goes to the database. Each query then costs about 10 ms instead of about 60 ms across the country, and a Bay Area visitor pays one cross-country round trip per page instead of one per query.

### The variables

These are the names from `.env.example`. Set them in Railway (service `calvin` → Variables) and **seal** each secret. `.railway/railway.ts` declares them with `preserve()`, which keeps them on apply. A variable it doesn't declare is deleted on apply.

| Variable | Value | Seal |
|---|---|---|
| `BASE_URL` | Don't set: `.railway/railway.ts` sets it to `https://$CALVIN_DOMAIN` | — |
| `PORT` | Don't set: `.railway/railway.ts` sets it to `8080`, the port the custom domain routes to (the health check uses it too) | — |
| `DATABASE_URL` | Neon's direct connection string | yes |
| `ANTHROPIC_API_KEY` | The key from calvin's capped Anthropic workspace | yes |
| `ANTHROPIC_MODEL` | Leave unset (the default is `claude-sonnet-5-5`); never set it empty | — |
| `RESEND_API_KEY` | The sending-only key for `send.<domain>` | yes |
| `EMAIL_FROM` | Such as `calvin <plans@send.<domain>>` | no |
| `TEMPORAL_ADDRESS` | The endpoint Temporal Cloud shows for API-key connections to the namespace, with port `7233` | no |
| `TEMPORAL_NAMESPACE` | `<namespace>.<account>` | no |
| `TEMPORAL_API_KEY` | The namespace-scoped API key. With it set, the SDK uses TLS by itself. | yes |

## 2. Tools (once)

- Railway CLI 5.42.1 or newer: `railway login`.
- A testbed checkout with `npm ci` done (it installs the `railway` SDK that `.railway/railway.ts` imports). In it, `railway link` to the `calvin` project.

## 3. The first deploy

1. **Pick the commit.** Choose a `main` commit whose CI passed. Create `production` there: `git push origin <sha>:refs/heads/production`.
2. **Check out that commit**, then preview the service: `CALVIN_DOMAIN=<domain> railway config plan`. Expect one service, `calvin`, with:
   - source branch `production`;
   - the `DOCKERFILE` builder;
   - pre-deploy `node src/db/migrate.ts` and health check `/healthz`;
   - `us-east4-eqdc4a` with 1 replica, and sleeping off;
   - your domain;
   - `BASE_URL` set, and every other variable preserved.

   Nothing else in the project should change (`partial = "calvin"`).
3. **Apply it:** `CALVIN_DOMAIN=<domain> railway config apply`. The service may start a first deploy now and fail for lack of variables. That's harmless, because nothing is live yet.
4. **Set the variables** from the table above, sealing the secrets.
5. **Deploy:** in the dashboard, use Cmd+K, then "Deploy Latest Commit", which deploys `production`'s head. Watch these in order:
   - the build log;
   - the pre-deploy log (migrations, exit 0);
   - the health check passing;
   - the deploy log showing the Temporal worker `RUNNING`.
6. **Point the domain** at Railway: add the CNAME that Railway shows for the custom domain, and wait for its certificate.
7. **Smoke-test it yourself:**
   - `https://<domain>/healthz` answers `ok`.
   - Create a plan with your own email, and check the email arrives from `send.<domain>`.
   - Temporal Cloud shows a `plan-<id>` workflow running in calvin's namespace.

## 4. Deploying again

1. Pick a `main` commit whose CI passed. Read what changed since the last deploy: `git fetch origin`, then `git log origin/production..<sha>`.
2. If `.railway/railway.ts` changed, run `railway config plan`, then `railway config apply` (with `CALVIN_DOMAIN`), from that commit first. Railway's docs say it doesn't read `.railway/` when it deploys, so a push alone won't change the settings. An apply may itself redeploy the current `production` head with the new settings. If that deploy fails (for example, a new pre-deploy command that the old commit lacks), the live version keeps running, and the push in the next step fixes it.
3. Fast-forward `production`: `git push origin <sha>:production`. Never force-push. The push deploys. Watch the same four steps as in the first deploy. If migrations or the health check fail, the old version keeps running.

### After a testbed reset

A reset force-pushes `main`, so new `main` commits no longer descend from `production`, and the fast-forward push in step 3 is refused. Don't force-push `production`. Instead, give it a commit whose files are exactly `<sha>`'s and whose parents are the old `production` and `<sha>`:

```bash
git fetch origin
c=$(git commit-tree '<sha>^{tree}' -p origin/production -p <sha> -m "Deploy <sha> after a testbed reset")
git push origin "$c:production"
```

That push is a fast-forward and deploys `<sha>`'s files.

## 5. Rolling back

1. Railway → service `calvin` → Deployments, then the ⋯ menu on the last good deployment, then **Rollback**. Railway's docs say this restores that deployment's image and variables without a rebuild, and that deployments older than your plan's retention can't be rolled back to.
2. Migrations aren't undone. The rolled-back code runs against the newer schema, which works as long as migrations only add things (the rule for every migration).
3. Fix forward: revert or fix on `main` through a PR, then deploy as in step 4. Until then, `production` names the bad commit, not the live one.

## Still to confirm (not checked here)

- Railway's Hobby price, what usage it includes, and log retention.
- Which Neon plan calvin's existing project is on. The architecture assumes Free's limits (scale to zero after 5 idle minutes) and $0 toward NFR010.
- Whether `us-east4-eqdc4a` is still Railway's US East region id (Railway's regions page listed it on 2026-11-13; plain `us-east4` is not an id).
- That `railway config plan` accepts `preserve()` for variables not set yet. If it doesn't, set the variables before step 3.
- The exact Temporal Cloud endpoint for API-key connections, as the namespace page shows it.
- That Railway's edge overwrites any `X-Real-IP` a client sends. calvin's rate limits key on it; Railway's docs say only that it carries the client's IP.
- The "Deploy Latest Commit" command and the rollback menu, as described in Railway's docs (not tried here).
