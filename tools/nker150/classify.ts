import rules from './show-rules.json';

export interface SourceItem {
  identifier: string;
  title: string;
  creator: string;
}

export interface ShowClassification {
  showId: string;
  showLabel: string;
  unclassified: boolean;
}

type MatchRule = {
  field: 'identifier' | 'title' | 'creator' | 'any';
  phrase?: string;
  oneOf?: string[];
  regex?: string;
};

type ShowRule = {
  id: string;
  label: string;
  any?: MatchRule[];
  all?: MatchRule[];
  none?: MatchRule[];
  fallback?: boolean;
};

const orderedRules = (rules as unknown as { rules: ShowRule[] }).rules;

function valueFor(item: SourceItem, field: MatchRule['field']): string {
  if (field === 'any') return `${item.identifier} ${item.title} ${item.creator}`.toLowerCase();
  return String(item[field] ?? '').toLowerCase();
}

function matches(item: SourceItem, rule: MatchRule): boolean {
  const value = valueFor(item, rule.field);
  if (rule.phrase && !value.includes(rule.phrase.toLowerCase())) return false;
  if (rule.oneOf && !rule.oneOf.some((part) => value.includes(part.toLowerCase()))) return false;
  if (rule.regex && !new RegExp(rule.regex, 'i').test(value)) return false;
  return true;
}

export function classifyShow(item: SourceItem): ShowClassification {
  for (const rule of orderedRules) {
    if (rule.fallback) return { showId: rule.id, showLabel: rule.label, unclassified: true };
    const any = rule.any?.some((candidate) => matches(item, candidate)) ?? true;
    const all = rule.all?.every((candidate) => matches(item, candidate)) ?? true;
    const none = rule.none?.every((candidate) => !matches(item, candidate)) ?? true;
    if (any && all && none) return { showId: rule.id, showLabel: rule.label, unclassified: false };
  }
  throw new Error('show-rules.json must end with a fallback rule');
}

export { orderedRules as showRules };
