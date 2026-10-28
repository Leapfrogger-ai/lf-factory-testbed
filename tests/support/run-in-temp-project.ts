import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function runInTempProject(
  files: Record<string, string>,
  command: string[],
): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    const [program, ...args] = command;
    const result = spawnSync(program!, args, { cwd: dir, encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
