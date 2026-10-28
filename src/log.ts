type Level = 'info' | 'warn' | 'error';
type Context = Record<string, unknown>;

function write(level: Level, msg: string, context: Context = {}): void {
  process.stdout.write(JSON.stringify({ level, msg, time: Temporal.Now.instant().toString(), ...context }) + '\n');
}

export const log = {
  info: (msg: string, context?: Context) => write('info', msg, context),
  warn: (msg: string, context?: Context) => write('warn', msg, context),
  error: (msg: string, context?: Context) => write('error', msg, context),
};
