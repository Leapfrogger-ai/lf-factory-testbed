---
status: accepted
initiative: calvin
---

# One Temporal Cloud workflow per plan keeps the plan's time

Each published plan starts one workflow on Temporal Cloud (workflow ID `plan-<planId>`). It waits on durable timers for the commit deadline, the reminders and the check-in, and sends every email through activities. We chose this over a once-a-minute cron job sweeping a `scheduled_emails` table because the operator already has Temporal Cloud. It brings durable timers, retries and replay, which we would otherwise hand-roll, at about 100 actions per plan, so the cost is negligible.

## Considered Options

- **Cron job plus a due-items table** (Cloudflare Cron Trigger or an in-process ticker): cheaper and simpler infrastructure, but every story has to get polling, locking, retry and catch-up right by hand.
- **Resend's scheduled sending (`scheduledAt`)**: not used. Calling a plan off would mean storing and cancelling every scheduled email id, and it only covers emails, not the deadline call-off.

## Consequences

- Temporal workers poll Temporal Cloud from a long-running process, so calvin needs an always-on host (ADR 0003).
- Activities run at least once, so exactly-once email needs our own send ledger plus Resend idempotency keys (ADR 0002).
