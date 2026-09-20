export interface LocalM3uEntry {
  title: string;
  url: string;
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  duration?: number;
}

export function parseLocalM3u(text: string): LocalM3uEntry[] {
  const entries: LocalM3uEntry[] = [];
  let pending: Partial<LocalM3uEntry> | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const comma = line.lastIndexOf(',');
      const title = comma >= 0 ? line.slice(comma + 1).trim() : '';
      const readAttr = (name: string) =>
        line.match(new RegExp(`\\\\${name}=["']([^"']+)["']`, 'i'))?.[1];

      pending = {
        title,
        tvgId: readAttr('tvg-id'),
        tvgName: readAttr('tvg-name'),
        tvgLogo: readAttr('tvg-logo'),
        groupTitle: readAttr('group-title'),
        duration: Number(line.match(/^#EXTINF:(-?\d+)/)?.[1] ?? 0),
      };
      continue;
    }

    if (!line.startsWith('#') && pending) {
      if (pending.title) entries.push({ ...(pending as LocalM3uEntry), url: line });
      pending = null;
    }
  }

  return entries;
}

export function isLocalM3uFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.m3u') || file.name.toLowerCase().endsWith('.m3u8');
}

export async function readLocalM3u(file: File): Promise<LocalM3uEntry[]> {
  return parseLocalM3u(await file.text());
}
