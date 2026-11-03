import { readFileSync } from 'node:fs';
import type { SuggestResponse } from '../../src/suggest/suggest.ts';

export type FixtureName = 'good' | 'no-tool-call' | 'pause-turn' | 'refusal' | 'max-tokens';

export function loadFixture(name: FixtureName): SuggestResponse {
  const path = new URL(`../fixtures/anthropic/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as SuggestResponse;
}
