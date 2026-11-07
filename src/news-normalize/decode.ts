import { decodeHTMLStrict } from 'entities';
import type { Diagnostic, FieldOptions } from './types';

export const MAX_FIELD_CHARS = 20000;
export const MAX_DECODE_PASSES = 4;

/**
 * Code points that must never be produced from a numeric character reference.
 * 0x80-0x9F are NOT rejected: entities maps them via Windows-1252 (&#146; -> right quote).
 */
export function isDisallowedCodePoint(code: number): boolean {
  if (!Number.isFinite(code)) return true;
  if (code === 0) return true;
  if (code < 0 || code > 0x10ffff) return true;
  if (code <= 0x1f) return !(code === 0x09 || code === 0x0a || code === 0x0d);
  if (code === 0x7f) return true;
  if (code >= 0xd800 && code <= 0xdfff) return true;
  if (code >= 0xfdd0 && code <= 0xfdef) return true;
  if ((code & 0xfffe) === 0xfffe) return true;
  return false;
}

/**
 * One entity-decoding pass. Every `&...;` reference in `text` is decoded exactly once;
 * the output is never re-scanned. Disallowed numeric references and unknown names stay literal
 * and are reported through `onDiagnostic` (input-side detection, so a surviving `&amp;`
 * produced by an earlier pass is never reported as unknown).
 */
export function decodeStrictPass(
  text: string,
  onDiagnostic?: (diagnostic: Diagnostic) => void
): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.charCodeAt(0) === 0x23) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (isDisallowedCodePoint(code)) {
        onDiagnostic?.({ code: 'disallowed-codepoint', detail: match });
        return match;
      }
      return decodeHTMLStrict(match);
    }
    const decoded = decodeHTMLStrict(match);
    if (decoded === match) {
      onDiagnostic?.({ code: 'unknown-entity', detail: match });
    }
    return decoded;
  });
}

/**
 * Removes markup with a small state machine (no regex over the whole input, no backtracking).
 * Handles comments, CDATA, declarations, script/style bodies, quoted attribute values and
 * stray '<' characters ("5 < 10", "<3"), which are kept literally.
 * Output is plain text for text-node rendering only.
 */
export function tokenizeAndStripHtml(input: string): string {
  let result = '';
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];
    if (ch !== '<') {
      result += ch;
      i++;
      continue;
    }

    if (input.startsWith('<!--', i)) {
      const endComment = input.indexOf('-->', i + 4);
      if (endComment === -1) break;
      i = endComment + 3;
      result += ' ';
      continue;
    }

    if (input.startsWith('<![CDATA[', i)) {
      const endCdata = input.indexOf(']]>', i + 9);
      if (endCdata !== -1) {
        result += input.slice(i + 9, endCdata);
        i = endCdata + 3;
        continue;
      }
    }

    const next = input[i + 1];
    if (next === '!' || next === '?') {
      const endDecl = input.indexOf('>', i + 2);
      if (endDecl !== -1) {
        i = endDecl + 1;
        result += ' ';
        continue;
      }
      result += '<';
      i++;
      continue;
    }

    let tagStart = i + 1;
    let isClosing = false;
    if (input[tagStart] === '/') {
      isClosing = true;
      tagStart++;
    }

    if (!/[a-zA-Z]/.test(input[tagStart] ?? '')) {
      result += '<';
      i++;
      continue;
    }

    let nameEnd = tagStart;
    while (nameEnd < len && /[a-zA-Z0-9-]/.test(input[nameEnd])) nameEnd++;
    const tagName = input.slice(tagStart, nameEnd).toLowerCase();

    let tagEnd = nameEnd;
    let inQuote: '"' | "'" | null = null;
    let foundEnd = false;
    while (tagEnd < len) {
      const tc = input[tagEnd];
      if (inQuote) {
        if (tc === inQuote) inQuote = null;
      } else if (tc === '"' || tc === "'") {
        inQuote = tc;
      } else if (tc === '>') {
        foundEnd = true;
        break;
      }
      tagEnd++;
    }

    if (!foundEnd) {
      result += '<';
      i++;
      continue;
    }

    if (!isClosing && (tagName === 'script' || tagName === 'style')) {
      const closer = new RegExp(`</${tagName}\\s*>`, 'ig');
      closer.lastIndex = tagEnd + 1;
      const m = closer.exec(input);
      if (!m) break;
      i = m.index + m[0].length;
      result += ' ';
      continue;
    }

    if (/^(p|div|br|hr|h[1-6]|li|tr|blockquote|section|article)$/.test(tagName)) result += ' ';
    i = tagEnd + 1;
  }

  return result;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function decodeField(
  value: unknown,
  options: FieldOptions
): { text: string | null; complete: boolean; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const report = (d: Diagnostic): void => {
    const key = `${d.code}|${d.detail ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push(d);
  };

  if (value === undefined || value === null) return { text: null, complete: true, diagnostics };
  let str: string;
  if (typeof value === 'string') str = value;
  else if (typeof value === 'number' || typeof value === 'boolean') str = String(value);
  else {
    report({ code: 'non-string-input', detail: typeof value });
    return { text: null, complete: true, diagnostics };
  }
  if (str.length > MAX_FIELD_CHARS) {
    report({ code: 'input-too-large', detail: `Input exceeded ${MAX_FIELD_CHARS} characters` });
    return { text: null, complete: true, diagnostics };
  }

  if (options.format === 'plain') {
    const text = options.escaped === true ? decodeStrictPass(str, report) : str;
    return { text: collapse(text), complete: true, diagnostics };
  }

  if (options.format === 'html') {
    return { text: collapse(decodeStrictPass(tokenizeAndStripHtml(str), report)), complete: true, diagnostics };
  }

  const step = (s: string, sink?: (d: Diagnostic) => void): string => {
    const decoded = decodeStrictPass(s, sink);
    return options.markup === true ? tokenizeAndStripHtml(decoded) : decoded;
  };

  let current = str;
  for (let pass = 1; pass <= MAX_DECODE_PASSES; pass++) {
    const next = step(current, report);
    if (next === current) break;
    current = next;
  }
  if (step(current) !== current) {
    report({ code: 'normalization-limit', detail: `Hit ${MAX_DECODE_PASSES}-pass decoding limit` });
    return { text: null, complete: false, diagnostics };
  }
  return { text: collapse(current), complete: true, diagnostics };
}
