// Runs source contracts in priority order, each isolated: a throw or timeout in one
// hook becomes that source's 'offline' result and the others still run.
import type { HookContext, SourceContract, SourceResult } from './contract';

export interface SourceJob<T = unknown> {
  contract: SourceContract<T>;
  input: T;
}

export async function runSources(
  jobs: SourceJob<any>[],
  opts: { now?: Date; timeoutMs?: number } = {},
): Promise<SourceResult[]> {
  const ordered = [...jobs].sort((a, b) => a.contract.priority - b.contract.priority);
  const results: SourceResult[] = [];

  for (const { contract, input } of ordered) {
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    const ctx: HookContext = { now: opts.now ?? new Date(), signal: controller.signal };
    try {
      const result = await Promise.race([
        contract.hook(input, ctx),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error(`timed out after ${timeoutMs}ms`)), { once: true }),
        ),
      ]);
      results.push({ ...result, durationMs: Date.now() - started });
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
