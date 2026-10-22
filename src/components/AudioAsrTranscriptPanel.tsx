import { useEffect, useRef, useState } from 'react';

const LABEL = 'Machine transcript (Archive ASR, may contain errors)';
type Cue = { start: number; end: number; text: string };
type Payload = { source: 'asr'; label: string; sliceStart: number; bytes: number; cues: Cue[] };

export function AudioAsrTranscriptPanel(props: { identifier?: string; getAudio: () => HTMLAudioElement | null }) {
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sliceStart, setSliceStart] = useState(0);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function load(start: number) {
    if (!props.identifier) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setMessage('');
    try {
      const planResponse = await fetch(`/api/audio-asr/${encodeURIComponent(props.identifier)}/plan`, { cache: 'no-store', signal: request.signal });
      if (!planResponse.ok) {
        const error = await planResponse.json().catch(() => ({}));
        throw new Error(String(error.message ?? 'Machine transcript unavailable'));
      }
      const response = await fetch(`/api/audio-asr/${encodeURIComponent(props.identifier)}/slice?t=${start}/60`, { cache: 'no-store', signal: request.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.message ?? 'Machine transcript unavailable'));
      if (body.source !== 'asr' || body.label !== LABEL || !Array.isArray(body.cues)) throw new Error('Machine transcript response was invalid');
      setSliceStart(start);
      setPayload(body as Payload);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setPayload(null);
        setMessage(error instanceof Error ? error.message : 'Machine transcript unavailable');
      }
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setLoading(false);
      }
    }
  }

  function open() {
    setOpened(true);
    const time = Math.max(0, props.getAudio()?.currentTime ?? 0);
    void load(Math.floor(time / 60) * 60);
  }

  if (!props.identifier) return null;
  return (
    <section className="mt-3 rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-neutral-100" aria-label="Machine transcript">
      {!opened ? (
        <button type="button" onClick={open} className="min-h-11 rounded-md border border-neutral-500 px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          Open Machine transcript
        </button>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm">{LABEL}</strong>
            <span className="text-xs text-neutral-300">Minute beginning {Math.floor(sliceStart / 60)} · source: asr</span>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={loading || sliceStart < 60} onClick={() => void load(Math.max(0, sliceStart - 60))} className="min-h-11 rounded border border-neutral-500 px-3 disabled:opacity-50">Previous minute</button>
            <button type="button" disabled={loading || sliceStart >= 4 * 3600} onClick={() => void load(sliceStart + 60)} className="min-h-11 rounded border border-neutral-500 px-3 disabled:opacity-50">Next minute</button>
          </div>
          {loading && <p role="status" className="mt-2 text-sm">Loading machine transcript…</p>}
          {message && <p role="alert" className="mt-2 text-sm">{message}</p>}
          {payload && (
            <ol className="mt-2 max-h-64 space-y-2 overflow-y-auto text-sm" data-source={payload.source}>
              {payload.cues.map((cue, i) => (
                <li key={`${cue.start}-${i}`}>
                  <time className="mr-2 tabular-nums">{Math.floor(cue.start / 60)}:{String(Math.floor(cue.start % 60)).padStart(2, '0')}</time>
                  <span>{cue.text}</span>
                </li>
              ))}
              {!payload.cues.length && <li>No transcript text in this slice.</li>}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
