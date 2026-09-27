// Source contracts: one hook per media source, one output shape for all of them.
// A layer's failure is reported in its own SourceResult and never blocks another layer.
import type { Program } from '../../src/types';

export type SourceClass =
  | 'local_file' | 'classic_m3u' | 'archive_search'
  | 'archive_news' | 'ajn_audio' | 'ajn_media' | 'live_tv';

export type SourceStatus = 'ok' | 'partial' | 'restricted' | 'upstream_error' | 'offline';

export interface RejectedItem {
  id: string;
  reason: string;
}

export interface SourceResult {
  sourceClass: SourceClass;
  status: SourceStatus;
  /** Only items the hook verified as playable. */
  programs: Program[];
  /** Every item the hook skipped, with the reason (shown in diagnostics). */
  rejected: RejectedItem[];
  fetchedAt: string;
  durationMs?: number;
  error?: string;
}

export interface HookContext {
  now: Date;
  signal: AbortSignal;
}

export interface SourceContract<TInput = unknown> {
  sourceClass: SourceClass;
  /** Lower loads first. 0 = Local Files. */
  priority: number;
  hook(input: TInput, ctx: HookContext): Promise<SourceResult>;
}

/** Status from counts: nothing accepted and nothing rejected means the source had no items. */
export function statusFrom(programs: number, rejected: number): SourceStatus {
  if (programs > 0 && rejected === 0) return 'ok';
  if (programs > 0) return 'partial';
  return rejected > 0 ? 'partial' : 'ok';
}
