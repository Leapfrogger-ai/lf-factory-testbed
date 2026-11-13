import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createRailwayContext, project } from 'railway/iac';
import type { ServiceNode } from 'railway/iac';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import railway, { partial } from '../.railway/railway.ts';
import { createApp } from '../src/web/app.ts';
import type { AppDeps } from '../src/web/app.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const pkg = JSON.parse(read('package.json'));

// The names .env.example lists, set or commented out.
const envNames = read('.env.example')
  .split('\n')
  .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
  .filter((name): name is string => name !== undefined);

async function calvinService(domain = 'calvin.test'): Promise<ServiceNode> {
  process.env.CALVIN_DOMAIN = domain;
  const definition = await railway(createRailwayContext({ environment: 'production' }), project);
  const resources = (definition.resources ?? []).flat();
  expect(resources).toHaveLength(1);
  return resources[0] as ServiceNode;
}

describe('Railway service (.railway/railway.ts)', () => {
  let savedDomain: string | undefined;
  beforeEach(() => {
    savedDomain = process.env.CALVIN_DOMAIN;
  });
  afterEach(() => {
    if (savedDomain === undefined) delete process.env.CALVIN_DOMAIN;
    else process.env.CALVIN_DOMAIN = savedDomain;
  });

  it('applies only to calvin\'s own resources', () => {
    expect(partial).toBe('calvin');
  });

  it('deploys only from the production branch of the testbed', async () => {
    const svc = await calvinService();
    expect(svc.name).toBe('calvin');
    expect(svc.source).toMatchObject({ type: 'github', repo: 'Leapfrogger-ai/lf-factory-testbed', branch: 'production' });
  });

  it('builds from the Dockerfile', async () => {
    const svc = await calvinService();
    expect(svc.build).toMatchObject({ builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' });
    expect(existsSync('Dockerfile')).toBe(true);
  });

  it('runs one always-on replica in US East, near the Neon database, that restarts whenever it exits', async () => {
    const svc = await calvinService();
    expect(svc.deploy?.multiRegionConfig).toEqual({ 'us-east4-eqdc4a': { numReplicas: 1 } });
    expect(svc.deploy?.sleepApplication).toBe(false);
    expect(svc.deploy?.restartPolicyType).toBe('ALWAYS');
  });

  it('migrates before each deploy with the migration script', async () => {
    const svc = await calvinService();
    expect(svc.deploy?.preDeployCommand).toEqual(['node src/db/migrate.ts']);
    expect(read('src/db/migrate.ts')).toContain('import.meta.main');
  });

  it('gates the switch on a health check the app answers', async () => {
    const svc = await calvinService();
    const path = svc.deploy?.healthcheckPath;
    expect(path).toBe('/healthz');
    const app = createApp({} as AppDeps, { baseUrl: 'https://calvin.test' });
    const res = await app.request(path!);
    expect(res.status).toBe(200);
  });

  it('gives the worker time to finish in-flight work on a redeploy', async () => {
    const svc = await calvinService();
    expect(svc.deploy?.drainingSeconds).toBe(30);
  });

  it('serves the custom domain and derives BASE_URL from it', async () => {
    const svc = await calvinService('calvin.example.org');
    expect(svc.networking?.customDomains).toHaveProperty(['calvin.example.org']);
    expect(svc.variables?.BASE_URL).toMatchObject({ type: 'literal', value: 'https://calvin.example.org' });
  });

  it('routes the domain to the port the app listens on', async () => {
    const svc = await calvinService('calvin.example.org');
    const port = svc.variables?.PORT;
    expect(port).toMatchObject({ type: 'literal' });
    const listening = Number((port as { value: string }).value);
    expect(svc.networking?.customDomains?.['calvin.example.org']?.port).toBe(listening);
  });

  it('refuses to plan without CALVIN_DOMAIN', async () => {
    delete process.env.CALVIN_DOMAIN;
    await expect(async () => railway(createRailwayContext({ environment: 'production' }), project)).rejects.toThrow(
      /CALVIN_DOMAIN/,
    );
  });

  it('declares every .env.example name, keeping secrets out of the file', async () => {
    const svc = await calvinService();
    const declared = Object.keys(svc.variables ?? {}).sort();
    expect(declared).toEqual([...envNames].sort());
    for (const name of declared.filter((n) => n !== 'BASE_URL' && n !== 'PORT')) {
      expect(svc.variables?.[name], name).toEqual({ type: 'preserve' });
    }
  });
});

describe('Dockerfile', () => {
  const dockerfile = read('Dockerfile');
  const lines = dockerfile.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

  it('is pinned to Node 26 on Debian slim (the Temporal worker needs glibc)', () => {
    expect(lines[0]).toMatch(/^FROM node:26-[a-z]+-slim$/);
  });

  it('installs production dependencies only, from the lockfile', () => {
    expect(dockerfile).toContain('npm ci --omit=dev');
  });

  it('copies what the app reads at runtime, relative to its working directory', () => {
    // serveStatic reads ./public and migrate() reads ./drizzle, both relative to the cwd.
    expect(dockerfile).toMatch(/^WORKDIR \/app$/m);
    for (const dir of ['src', 'public', 'drizzle']) {
      expect(dockerfile, dir).toMatch(new RegExp(`^COPY ${dir} \\./${dir}$`, 'm'));
    }
  });

  it('has app code that imports nothing outside src/', () => {
    const appFiles = readdirSync('src', { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'),
    );
    expect(appFiles.length).toBeGreaterThan(0);
    for (const file of appFiles) {
      const from = join('src', file);
      for (const [, spec] of read(from).matchAll(/from\s+'(\.[^']+)'/g)) {
        expect(relative('src', resolve(dirname(from), spec)).startsWith('..'), `${from} imports ${spec}`).toBe(false);
      }
    }
  });

  it('runs as a non-root user', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
  });

  it('starts the app the way npm start does', () => {
    expect(lines.at(-1)).toBe(`CMD ${JSON.stringify(pkg.scripts.start.split(' '))}`);
  });

  it('keeps .env and local state out of the image', () => {
    const ignored = read('.dockerignore').split('\n').map((line) => line.trim());
    for (const entry of ['.env', '.env.*', 'node_modules', '.git', '.factory', '.superpowers']) {
      expect(ignored, entry).toContain(entry);
    }
  });
});

describe('railway SDK', () => {
  it('is pinned exactly, as a dev dependency', () => {
    expect(pkg.devDependencies.railway).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies.railway).toBeUndefined();
  });
});
