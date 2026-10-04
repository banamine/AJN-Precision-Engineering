// Runs source contracts in priority order, each isolated: a throw or timeout in one
// hook becomes that source's 'offline' result and the others still run.
import type { HookContext, SourceContract, SourceResult } from './contract';

const DEFAULT_GRACE_MS = 2_000;

export interface SourceJob<T = unknown> {
  contract: SourceContract<T>;
  input: T;
}

export async function runSources(
  jobs: SourceJob<any>[],
  opts: { now?: Date; timeoutMs?: number; parallel?: boolean; graceMs?: number } = {},
): Promise<SourceResult[]> {
  const ordered = [...jobs].sort((a, b) => a.contract.priority - b.contract.priority);
  if (opts.parallel) {
    // Independent sources: run together, results still in priority order.
    return Promise.all(ordered.map((job) => runSources([job], { ...opts, parallel: false }).then((r) => r[0])));
  }
  const results: SourceResult[] = [];

  for (const { contract, input } of ordered) {
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    const ctx: HookContext = { now: opts.now ?? new Date(), signal: controller.signal };
    try {
      const hookPromise = contract.hook(input, ctx);
      hookPromise.catch(() => {}); // a late rejection after abort must not be unhandled
      const aborted = new Promise<'aborted'>((resolve) => controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true }));
      const first = await Promise.race([hookPromise, aborted]);
      if (first === 'aborted') {
        // The hook was told to stop (ctx.signal). Give it a short grace period to hand back what it
        // already gathered; a hook that ignores the signal still ends as 'offline' (timed out).
        const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        const late = await Promise.race([
          hookPromise.then((r) => ({ r }), () => null),
          new Promise<null>((resolve) => { graceTimer = setTimeout(() => resolve(null), graceMs); }),
        ]);
        clearTimeout(graceTimer);
        if (!late) throw new Error(`timed out after ${timeoutMs}ms`);
        const r = late.r;
        results.push({
          ...r,
          status: r.status === 'ok' ? 'partial' : r.status,
          error: r.error ?? `timed out after ${timeoutMs}ms; returned partial results`,
          durationMs: Date.now() - started,
        });
      } else {
        results.push({ ...first, durationMs: Date.now() - started });
      }
    } catch (err: any) {
      results.push({
        sourceClass: contract.sourceClass,
        status: 'offline',
        programs: [],
        rejected: [],
        fetchedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        error: err?.message ?? String(err),
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}
