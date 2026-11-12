// calvin's Railway service (ADR 0006). Applied by the operator, never by CI:
//
//   CALVIN_DOMAIN=<domain> railway config plan
//   CALVIN_DOMAIN=<domain> railway config apply
//
// See docs/deploy-runbook.md for the first deploy, deploying again and rolling back.
import { defineRailway, github, preserve, project, service } from 'railway/iac';

// Applying this file touches only the resources it declares.
export const partial = 'calvin';

export default defineRailway((ctx) => {
  const domain = process.env.CALVIN_DOMAIN;
  if (!domain) throw new Error('Set CALVIN_DOMAIN to calvin\'s domain, such as calvin.example.com');

  const calvin = service('calvin', {
    // Only a push to `production` deploys, so merges to main (factory stories included) don't reach users.
    source: github('Leapfrogger-ai/lf-factory-testbed', { branch: 'production' }),
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    preDeploy: 'node src/db/migrate.ts',
    healthcheck: '/healthz',
    replicas: { 'us-west2': 1 },
    deploy: {
      // The Temporal worker must stay up for reminders to fire on time (NFR007).
      sleepApplication: false,
      restartPolicyType: 'ALWAYS',
      // SIGTERM to SIGKILL: time for worker.shutdown() to stop cleanly. In-flight activities are
      // cancelled (shutdownGraceTime is 0) and Temporal retries them on the new worker; the send ledger keeps emails to one.
      drainingSeconds: 30,
    },
    // The domain routes to PORT; set both, so Railway can't inject a different PORT than the domain targets.
    domains: [{ domain, port: 8080 }],
    env: {
      PORT: '8080',
      BASE_URL: `https://${domain}`,
      // Set in Railway's dashboard; preserve() keeps them on apply. A variable left out here is deleted on apply.
      DATABASE_URL: preserve(),
      ANTHROPIC_API_KEY: preserve(),
      ANTHROPIC_MODEL: preserve(),
      RESEND_API_KEY: preserve(),
      EMAIL_FROM: preserve(),
      TEMPORAL_ADDRESS: preserve(),
      TEMPORAL_NAMESPACE: preserve(),
      TEMPORAL_API_KEY: preserve(),
    },
  });

  return project(ctx.projectName ?? 'calvin', { resources: [calvin] });
});
