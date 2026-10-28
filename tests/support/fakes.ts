import type { Schedule } from '../../src/domain/plan-rules.ts';

export function fakeEmail() {
  const calls: { payload: unknown; idempotencyKey: string }[] = [];
  let failures = 0;
  return {
    calls,
    failNext(): void {
      failures += 1;
    },
    send: async (payload: unknown, idempotencyKey: string): Promise<{ id: string }> => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('email send failed');
      }
      calls.push({ payload, idempotencyKey });
      return { id: `email-${calls.length}` };
    },
  };
}

export function fakePlanWorkflows() {
  const startCalls: { planId: string; schedule: Schedule }[] = [];
  const signalCalls: { planId: string; signal: string; arg?: unknown }[] = [];
  let startError: Error | undefined;
  return {
    startCalls,
    signalCalls,
    failStart(error: Error): void {
      startError = error;
    },
    start: async (planId: string, schedule: Schedule): Promise<void> => {
      if (startError) throw startError;
      startCalls.push({ planId, schedule });
    },
    signal: async (planId: string, signal: string, arg?: unknown): Promise<void> => {
      signalCalls.push({ planId, signal, arg });
    },
  };
}

export function fakeSuggest(fixture: unknown = {}) {
  const calls: unknown[] = [];
  return {
    calls,
    call: async (request: unknown): Promise<unknown> => {
      calls.push(request);
      return fixture;
    },
  };
}

export function fixedClock(iso: string): () => Temporal.Instant {
  const instant = Temporal.Instant.from(iso);
  return () => instant;
}
