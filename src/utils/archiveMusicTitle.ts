export interface ArchiveMusicTitle {
  title: string;
  artist: string;
  /** Decoded original filename, before display-only cleanup. */
  rawFilename: string;
}

function decodeFilename(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Clean an Archive download path for display only; source IDs and URLs stay untouched. */
export function cleanArchiveMusicFilename(input: string | null | undefined): ArchiveMusicTitle {
  const raw = String(input ?? "").trim();
  if (!raw) return { title: "", artist: "", rawFilename: "" };

  let path = raw;
  try {
    const url = new URL(raw, "https://archive.invalid");
    path = url.pathname === "/api/archive/proxy"
      ? (url.searchParams.get("path") || url.pathname)
      : url.pathname;
  } catch {
    // Plain filenames and paths are valid inputs too.
  }

  const encodedFilename = path.split(/[\\/]/).filter(Boolean).pop() || path;
  const rawFilename = decodeFilename(encodedFilename);
  let stem = rawFilename
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\d{1,4}(?:\s*[.-]\s*|\s+)+/, "")
    .trim()
    .replace(/\s+/g, " ");

  const separator = stem.indexOf(" - ");
  if (separator > 0 && separator < stem.length - 3) {
    return {
      artist: stem.slice(0, separator).trim(),
      title: stem.slice(separator + 3).trim(),
      rawFilename,
    };
  }

  return { title: stem || rawFilename, artist: "", rawFilename };
}
