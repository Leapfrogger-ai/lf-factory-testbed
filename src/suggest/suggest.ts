import { z } from 'zod';
import { localToInstant } from '../domain/time.ts';

export const SUGGEST_MODEL = 'claude-sonnet-5-5';
export const MAX_SEARCH_USES = 2;
const TIMEOUT_MS = 20_000;
const TIMEOUT_ERROR_NAMES = ['APIConnectionTimeoutError', 'APIUserAbortError'];

export type SuggestInput = { city: string; area: string; timeWindow: string };
export type SuggestRequest = ReturnType<typeof buildSuggestRequest>;
export type SuggestResponse = {
  stop_reason: string | null;
  content: { type: string; name?: string; input?: unknown }[];
};
export type SuggestPlanCall = (request: SuggestRequest, options: { signal: AbortSignal }) => Promise<SuggestResponse>;

const SYSTEM = [
  'You suggest one concrete, low-stakes plan for a small group of strangers to meet in the San Francisco Bay Area.',
  'Pick an easy format such as coffee, drinks or a walk, in a public place.',
  "Never propose hosting at someone's home.",
  'Use web search to check that the venue is real and open at that time, then call propose_plan exactly once.',
  'Give the date as YYYY-MM-DD and the time as HH:MM on the Pacific wall clock. Leave venue_address and venue_url empty when unknown.',
].join(' ');

export function buildSuggestRequest(input: SuggestInput, model: string = SUGGEST_MODEL) {
  return {
    model,
    max_tokens: 2048,
    output_config: { effort: 'low' as const },
    system: SYSTEM,
    messages: [
      {
        role: 'user' as const,
        content: `City: ${input.city}\nRough area: ${input.area}\nRough time: ${input.timeWindow}\n\nSuggest one plan.`,
      },
    ],
    tools: [
      {
        type: 'web_search_20260318',
        name: 'web_search',
        max_uses: MAX_SEARCH_USES,
        user_location: {
          type: 'approximate',
          city: input.city,
          region: 'California',
          country: 'US',
          timezone: 'America/Los_Angeles',
        },
      },
      {
        name: 'propose_plan',
        description: 'Propose one concrete plan for the group to meet.',
        strict: true,
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['format', 'venue', 'venue_address', 'venue_url', 'date', 'time', 'minimum'],
          properties: {
            format: { type: 'string', description: 'A low-stakes format, such as coffee, drinks or a walk.' },
            venue: { type: 'string', description: 'The name of a real venue.' },
            venue_address: { type: 'string', description: 'Street address, or empty when unknown.' },
            venue_url: { type: 'string', description: 'The venue web page, or empty when unknown.' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            time: { type: 'string', description: 'HH:MM, Pacific wall clock' },
            minimum: { type: 'integer', description: 'How many people it takes for the plan to go ahead.' },
          },
        },
      },
    ],
  };
}

export type FailureReason =
  | 'timeout'
  | 'api_error'
  | 'no_proposal'
  | 'pause_turn'
  | 'refusal'
  | 'max_tokens'
  | 'invalid_proposal';
export type Proposal = {
  format: string;
  venue: string;
  venueAddress: string | null;
  venueUrl: string | null;
  gatheringAt: Temporal.Instant;
  minimum: number;
};
export type SuggestResult = (
  | { outcome: 'ok'; proposal: Proposal }
  | { outcome: 'failed'; failureReason: FailureReason }
) & { latencyMs: number };

const proposalInput = z.object({
  format: z.string().trim().min(1).max(40),
  venue: z.string().trim().min(1).max(120),
  venue_address: z.string().trim(),
  venue_url: z.string().trim(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  minimum: z.number().int().min(2),
});

export async function suggest(
  input: SuggestInput,
  deps: { suggestPlanCall: SuggestPlanCall; now: () => Temporal.Instant; model?: string },
): Promise<SuggestResult> {
  const before = deps.now();
  const failed = (failureReason: FailureReason): SuggestResult => ({
    outcome: 'failed',
    failureReason,
    latencyMs: deps.now().epochMilliseconds - before.epochMilliseconds,
  });
  let response: SuggestResponse;
  try {
    response = await deps.suggestPlanCall(buildSuggestRequest(input, deps.model), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return failed(TIMEOUT_ERROR_NAMES.includes(name) ? 'timeout' : 'api_error');
  }
  if (response.stop_reason === 'pause_turn') return failed('pause_turn');
  if (response.stop_reason === 'refusal') return failed('refusal');
  if (response.stop_reason === 'max_tokens') return failed('max_tokens');
  const call = response.content.find((block) => block.type === 'tool_use' && block.name === 'propose_plan');
  if (!call) return failed('no_proposal');
  const parsed = proposalInput.safeParse(call.input);
  if (!parsed.success) return failed('invalid_proposal');
  const raw = parsed.data;
  let gatheringAt: Temporal.Instant;
  try {
    gatheringAt = localToInstant(raw.date, raw.time);
  } catch {
    return failed('invalid_proposal');
  }
  if (Temporal.Instant.compare(gatheringAt, deps.now()) <= 0) return failed('invalid_proposal');
  return {
    outcome: 'ok',
    latencyMs: deps.now().epochMilliseconds - before.epochMilliseconds,
    proposal: {
      format: raw.format,
      venue: raw.venue,
      venueAddress: raw.venue_address || null,
      venueUrl: raw.venue_url || null,
      gatheringAt,
      minimum: raw.minimum,
    },
  };
}
