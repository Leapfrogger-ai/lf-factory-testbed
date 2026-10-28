import { z } from 'zod';

export const CITIES: readonly string[] = [
  'San Francisco',
  'Oakland',
  'Berkeley',
  'Alameda',
  'Emeryville',
  'Daly City',
  'San Mateo',
  'Redwood City',
  'Palo Alto',
  'Mountain View',
  'Sunnyvale',
  'Santa Clara',
  'San Jose',
  'Fremont',
  'Walnut Creek',
];

export type Config = {
  baseUrl: string;
  port: number;
  databaseUrl: string;
  anthropicApiKey: string;
  anthropicModel: string;
  resendApiKey: string;
  emailFrom: string;
  temporalAddress: string;
  temporalNamespace: string;
};

const envSchema = z.object({
  BASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
});

// TEMPORAL_API_KEY is optional and not validated here: @temporalio/envconfig reads it.
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Names only: a zod message can echo the offending value.
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'unknown')))];
    throw new Error(`Invalid environment: ${names.join(', ')}`);
  }
  const e = parsed.data;
  return {
    baseUrl: e.BASE_URL,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    anthropicModel: e.ANTHROPIC_MODEL,
    resendApiKey: e.RESEND_API_KEY,
    emailFrom: e.EMAIL_FROM,
    temporalAddress: e.TEMPORAL_ADDRESS,
    temporalNamespace: e.TEMPORAL_NAMESPACE,
  };
}
