import { useEffect, useState } from "react";

export interface FolderArt { url: string; name: string }

/** "/download/<id>/<file>" from any of the forms an item reference takes, else null. */
export function archiveDownloadPath(ref: string | undefined): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref, "http://x.invalid");
    if (u.pathname === "/api/archive/proxy") return u.searchParams.get("path");
    if (u.hostname === "archive.org" || u.hostname === "x.invalid") return u.pathname.startsWith("/download/") ? decodeURI(u.pathname) : null;
  } catch { /* not a URL */ }
  return ref.startsWith("/download/") ? ref : null;
}

const cache = new Map<string, FolderArt[]>();
const folderKey = (p: string) => p.slice(0, p.lastIndexOf("/"));

/** Images from the track's own Archive folder (server decides; empty = honestly none). Audio only. */
export function useFolderArt(ref: string | undefined, enabled: boolean): FolderArt[] {
  const path = enabled ? archiveDownloadPath(ref) : null;
  const key = path ? folderKey(path) : "";
  const [art, setArt] = useState<FolderArt[]>(() => (key && cache.get(key)) || []);
  useEffect(() => {
    if (!path) { setArt([]); return; }
    const hit = cache.get(key);
    if (hit) { setArt(hit); return; }
    setArt([]);
    const ac = new AbortController();
    fetch(`/api/archive/folder-art?path=${encodeURIComponent(path)}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.images)) return;
        if (cache.size > 200) cache.clear();
        cache.set(key, d.images);
        setArt(d.images);
      })
      .catch(() => { /* no art is a valid state; the lookup error is not shown as art */ });
    return () => ac.abort();
  }, [path, key]);
  return art;
}
