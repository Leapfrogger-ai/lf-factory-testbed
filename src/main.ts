import { serve } from '@hono/node-server';
import { Resend } from 'resend';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { createSendEmail } from './email/send-email.ts';
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

const app = createApp(
  {
    db,
    now: () => Temporal.Now.instant(),
    // Stub until the suggestion story (Rulings).
    suggestPlanCall: async () => {
      throw new Error('Suggestions are not available yet');
    },
    sendEmail: createSendEmail({ resend: new Resend(config.resendApiKey), from: config.emailFrom }),
    planWorkflows: createPlanWorkflows(client),
  },
  { baseUrl: config.baseUrl },
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
