import fs from 'node:fs';

export function parseCsv(input: string): Array<Record<string, string>> {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some(Boolean)) records.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (row.length || field) { row.push(field.replace(/\r$/, '')); records.push(row); }
  const [header, ...body] = records;
  if (!header?.length) throw new Error('CSV has no header');
  return body.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])));
}

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function writeCsv(filePath: string, headers: string[], rows: unknown[][]): void {
  const content = [headers.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\n');
  fs.writeFileSync(filePath, `${content}\n`);
}
