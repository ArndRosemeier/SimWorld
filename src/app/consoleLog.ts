/**
 * The page's recent console errors and warnings, kept for "Report this spot" (src/game/report.ts): console.error
 * and console.warn calls, uncaught errors and unhandled promise rejections, the newest `KEEP`. Installed once, first
 * thing in main.ts; the console still prints everything as before.
 */
const KEEP = 30;
const kept: { kind: string; at: string; msg: string; n: number }[] = [];
let installed = false;

const stamp = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

/** One value as a short line (an error with the first line of its stack). */
function text(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? ` @ ${v.stack.split('\n').find((l) => l.includes('at ') || l.includes('@'))?.trim() ?? ''}` : ''}`;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

function keep(kind: string, args: unknown[]): void {
  const msg = args.map(text).join(' ').slice(0, 400), last = kept[kept.length - 1];
  // The same message over and over counts once, with how often.
  if (last && last.kind === kind && last.msg === msg) { last.n++; return; }
  kept.push({ kind, at: stamp(), msg, n: 1 });
  if (kept.length > KEEP) kept.shift();
}

/** Start keeping the console's errors and warnings (once). */
export function watchConsole(): void {
  if (installed) return;
  installed = true;
  for (const kind of ['error', 'warn'] as const) {
    const orig = console[kind].bind(console);
    console[kind] = (...args: unknown[]) => { keep(kind, args); orig(...args); };
  }
  addEventListener('error', (e) => keep('uncaught', [e.error ?? e.message]));
  addEventListener('unhandledrejection', (e) => keep('rejected', [e.reason]));
}

/** The kept lines, oldest first. */
export function recentConsole(): string[] {
  return kept.map((k) => `[${k.kind} ${k.at}] ${k.msg}${k.n > 1 ? ` (×${k.n})` : ''}`);
}
