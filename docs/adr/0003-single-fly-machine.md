---
status: accepted
initiative: calvin
---

# One always-on Fly.io machine runs the web server and the Temporal worker in one process

calvin is one Node process on one `shared-cpu-1x` 512MB Fly Machine in `sjc`, with `auto_stop_machines = "off"`. It serves the Hono web app and runs the Temporal worker. The worker has to stay up for timers to fire on time (NFR007), and Fly's autostop only counts proxy traffic, so it would stop an idle worker. Separate `[processes]` groups would each get their own machine and double the cost. This comes to about $4.50/month with Neon Free.

## Considered Options

- **Serverless (Cloudflare Workers, Vercel)**: can't host a long-polling Temporal worker.
- **Web on serverless plus a separate worker host**: two deploy targets for a 3–5-plan trial.

## Consequences

- No redundancy: a deploy or a crash pauses timers and pages briefly. Timers fire late rather than being lost, and that's acceptable at PoC maturity.
