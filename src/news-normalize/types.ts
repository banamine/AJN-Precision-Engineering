export type FieldFormat = 'plain' | 'html' | 'multi-encoded';

export type DateStatus = 'valid' | 'missing' | 'malformed' | 'ambiguous';

/**
 * Per-field declaration made by the source adapter (never inferred from content).
 * - plain: text is used as-is; entities are decoded once only when `escaped` is true.
 * - html: tags are removed with a tokenizer, then entities are decoded once.
 * - multi-encoded: known multiply encoded upstream text; at most 4 decode passes
 *   (tags are removed on each pass only when `markup` is true).
 */
export interface FieldOptions {
  readonly format: FieldFormat;
  readonly escaped?: boolean;
  readonly markup?: boolean;
}

export interface SourceConfig {
  readonly sourceId: string;
  readonly fields: {
    readonly title: FieldOptions;
    readonly summary: FieldOptions;
  };
  readonly trackingParams: readonly string[];
}

export type RawItem = Readonly<Record<string, unknown>>;

export interface Diagnostic {
  readonly code: string;
  readonly field?: 'title' | 'summary' | 'url' | 'date';
  readonly detail?: string;
}

export interface NormalizedItem {
  readonly schemaVersion: 1;
  readonly normalized: true;
  readonly id: string;
  readonly title: string | null;
  readonly summary: string | null;
  readonly sourceName: string;
  /** Original URL string exactly as received (provenance). */
  readonly articleUrl: string;
  /** Validated http/https navigation URL (parsed form). Not permission to fetch, proxy or embed. */
  readonly navigationUrl: string | null;
  /** Comparison key only; http and https are NOT collapsed. */
  readonly urlKey: string | null;
  readonly imageUrl: string | null;
  readonly publishedAt: string | null;
  readonly broadcastAt: string | null;
  readonly fetchedAt: string | null;
  readonly dateStatus: DateStatus;
  readonly broadcastStatus: DateStatus;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface NormalizeBatchResult {
  readonly items: readonly NormalizedItem[];
  readonly withheld: readonly {
    readonly item: NormalizedItem;
    readonly reason: string;
  }[];
  readonly counts: {
    readonly total: number;
    readonly valid: number;
    readonly withheld: number;
    readonly rejected: number;
  };
}
