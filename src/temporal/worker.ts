import { fileURLToPath } from 'node:url';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import { NativeConnection, Worker } from '@temporalio/worker';
import type { Db } from '../db/client.ts';
import type { SendEmail } from '../email/send-email.ts';
import { createActivities } from './activities.ts';
import { TASK_QUEUE } from './client.ts';

export async function startWorker(deps: {
  db: Db;
  sendEmail: SendEmail;
  baseUrl: string;
}): Promise<{ run(): Promise<void>; shutdown(): void }> {
  const { connectionOptions, namespace } = loadClientConnectConfig();
  const connection = await NativeConnection.connect(connectionOptions);
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
    activities: createActivities(deps),
  });
  return {
    run: () => worker.run(),
    shutdown: () => worker.shutdown(),
  };
}
