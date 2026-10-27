---
status: accepted
initiative: calvin
---

# Postgres owns plan state; the workflow only keeps time

The plan's state (open, confirmed, called off), its commits and its event log live in Postgres. Web handlers change them in one transaction that locks the plan row, so the row lock, not the workflow, decides which commit confirms a plan. After the commit, the handler sends the plan's workflow a **Signal** (`confirmed`, `committed`, `calledOff`), which only wakes it up. Every activity re-reads Postgres before acting, and every email is recorded in an `email_sends` ledger with a unique `(commit_id, kind)` key. Pages therefore read one store, stay fast, and keep working while the worker is down, because Temporal Cloud accepts Signals with no worker running.

## Considered Options

- **The workflow owns state, and Postgres is a projection** (commits as Workflow Updates, reads as Queries). Native option considered: Workflow Update and Query, not used. Every page write and read would need a round trip to Temporal Cloud and a running worker, and there would be two copies of the state to keep in step.

## Consequences

- If a Signal is lost, the workflow still sees the true state when its next timer fires, because its activities read Postgres. A lost `confirmed` Signal delays the confirmation emails to the deadline at worst.
- Exactly-once email is: insert a ledger row if there isn't one, send with Resend `idempotencyKey = <kind>/<planId>/<commitId>` only if the row isn't marked sent, then mark it sent. Activity retries are capped below Resend's 24h key window.
