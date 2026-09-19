import { useCallback, useEffect, useState } from 'react';
import { FileAudio, FileVideo, FolderOpen, Trash2 } from 'lucide-react';
import { PlayProgramCallback } from '../types';
import {
  LocalMediaEntry,
  buildLocalMediaSchedule,
  createLocalMediaEntry,
  isLikelyNativePlayable,
  isSupportedLocalMediaFile,
  releaseLocalMediaEntry,
} from '../localMediaEpg';

interface Props {
  onPlayProgram?: PlayProgramCallback;
  onScheduleChange?: (channels: ReturnType<typeof buildLocalMediaSchedule>) => void;
}

async function collectDirectoryFiles(dir: FileSystemDirectoryHandle): Promise<File[]> {
  const files: File[] = [];
  for await (const [, handle] of dir.entries()) {
    if (handle.kind !== 'file') continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    if (isSupportedLocalMediaFile(file)) files.push(file);
  }
  return files;
}

export function LocalMediaPanel({ onPlayProgram, onScheduleChange }: Props) {
  const [entries, setEntries] = useState<LocalMediaEntry[]>([]);
  const [directoryName, setDirectoryName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback((next: LocalMediaEntry[]) => {
    setEntries(next);
    onScheduleChange?.(buildLocalMediaSchedule(next));
  }, [onScheduleChange]);

  const addFiles = useCallback(async (files: File[], folder?: string) => {
    const supported = files.filter(isSupportedLocalMediaFile);
    if (!supported.length) {
      setError('No supported local media files found.');
      return;
    }
    const next = supported.map((file) => createLocalMediaEntry(file, folder));
    next.forEach((entry) => {
      const fileType = entry.mimeType || '';
      if (entry.name.toLowerCase().endsWith('.mkv') && !isLikelyNativePlayable('video', new File([], entry.name, { type: fileType }))) {
        console.warn('[AJN LOCAL MEDIA] Browser may not natively decode MKV', { file: entry.name, mimeType: fileType });
      }
    });
    entries.forEach(releaseLocalMediaEntry);
    publish(next);
    setError(null);
  }, [entries, publish]);

  const chooseFiles = useCallback(async () => {
    setError(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.mp3,.mp4,.m4v,.m4a,.m4,.mkv,.m3u';
    const files = await new Promise<File[]>((resolve) => {
      input.onchange = () => resolve(Array.from(input.files || []));
      input.click();
    });
    const mediaFiles = files.filter(isSupportedLocalMediaFile);
    await addFiles(mediaFiles);
  }, [addFiles]);

  const chooseFolder = useCallback(async () => {
    setError(null);
    const picker = (window as Window & {
      showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    if (!picker) {
      setError('Folder selection is not supported by this browser.');
      return;
    }
    try {
      const dir = await picker({ mode: 'read' });
      const files = await collectDirectoryFiles(dir);
      setDirectoryName(dir.name);
      await addFiles(files, dir.name);
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [addFiles]);

  const clear = useCallback(() => {
    entries.forEach(releaseLocalMediaEntry);
    publish([]);
    setDirectoryName('');
    setError(null);
  }, [entries, publish]);

  useEffect(() => () => entries.forEach(releaseLocalMediaEntry), [entries]);

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Local Media EPG</h2>
          <p className="text-xs text-neutral-400">Select a folder or files on this device. Nothing is uploaded.</p>
        </div>
        <span className="text-[11px] font-mono text-neutral-500">{entries.length} items</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={chooseFolder} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white">
          <FolderOpen className="h-3.5 w-3.5" /> Add Folder
        </button>
        <button type="button" onClick={chooseFiles} className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-100">
          <FolderOpen className="h-3.5 w-3.5" /> Add Files
        </button>
        <button type="button" onClick={clear} disabled={!entries.length} className="inline-flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300 disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" /> Clear EPG
        </button>
      </div>

      {directoryName && <p className="text-[11px] text-neutral-500">Folder: {directoryName}</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onPlayProgram?.(entry.objectUrl, entry.name, 'Local Files', entry.mediaType, 'local-media-channel', 'local-media', entry.id)}
            className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-3 text-left hover:border-neutral-700"
          >
            <div className="flex items-center gap-2">
              {entry.mediaType === 'audio' ? <FileAudio className="h-4 w-4 text-amber-400" /> : <FileVideo className="h-4 w-4 text-sky-400" />}
              <span className="truncate text-xs font-medium text-neutral-100">{entry.name}</span>
            </div>
            <div className="mt-1 text-[10px] text-neutral-500">{entry.mediaType} · {Math.round(entry.size / 1024 / 1024)} MB</div>
          </button>
        ))}
      </div>
    </section>
  );
}
