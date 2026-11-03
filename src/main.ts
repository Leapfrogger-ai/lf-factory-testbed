import Anthropic from '@anthropic-ai/sdk';
import { serve } from '@hono/node-server';
import { Resend } from 'resend';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { createSendEmail } from './email/send-email.ts';
import { createSuggestPlanCall } from './suggest/suggest.ts';
import { connectTemporalClient, createPlanWorkflows } from './temporal/client.ts';
import { startWorker } from './temporal/worker.ts';
import { createApp } from './web/app.ts';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : 'Invalid environment');
  process.exit(1);
}

const { db, pool } = createDb(config.databaseUrl);
const client = await connectTemporalClient();
const worker = await startWorker();

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey, timeout: 20_000, maxRetries: 0 });

const app = createApp(
  {
    db,
    now: () => Temporal.Now.instant(),
    suggestPlanCall: createSuggestPlanCall(anthropic),
    sendEmail: createSendEmail({ resend: new Resend(config.resendApiKey), from: config.emailFrom }),
    planWorkflows: createPlanWorkflows(client),
  },
  { baseUrl: config.baseUrl, anthropicModel: config.anthropicModel },
);

const server = serve({ fetch: app.fetch, port: config.port });
const workerDone = worker.run();

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  worker.shutdown();
  server.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await workerDone;
await pool.end();
