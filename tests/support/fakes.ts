import type { Schedule } from '../../src/domain/plan-rules.ts';
import type { SuggestRequest, SuggestResponse } from '../../src/suggest/suggest.ts';

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

export function fakeSuggest(fixture: SuggestResponse = { stop_reason: 'end_turn', content: [] }) {
  const calls: { request: SuggestRequest; options: { signal: AbortSignal } }[] = [];
  let failure: Error | undefined;
  return {
    calls,
    failWith(error: Error): void {
      failure = error;
    },
    call: async (request: SuggestRequest, options: { signal: AbortSignal }): Promise<SuggestResponse> => {
      calls.push({ request, options });
      if (failure) {
        const error = failure;
        failure = undefined;
        throw error;
      }
      return fixture;
    },
  };
}

export function fixedClock(iso: string): () => Temporal.Instant {
  const instant = Temporal.Instant.from(iso);
  return () => instant;
}
