import { fileURLToPath } from 'node:url';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import { NativeConnection, Worker } from '@temporalio/worker';
import { TASK_QUEUE } from './client.ts';

export async function startWorker(): Promise<{ run(): Promise<void>; shutdown(): void }> {
  const { connectionOptions, namespace } = loadClientConnectConfig();
  const connection = await NativeConnection.connect(connectionOptions);
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
  });
  return {
    run: () => worker.run(),
    shutdown: () => worker.shutdown(),
  };
}
