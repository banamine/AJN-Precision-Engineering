import { useState, useRef } from 'react';
import { Play, Search, AlertCircle, ShieldCheck, Video, RefreshCw, FileText } from 'lucide-react';
import { ProbeResult } from '../types';

const SAMPLE_PATHS = [
  { label: 'NASA Apollo 11 Clip', path: '/download/Apollo11AudioHighlights/apollo_11_audio_highlights_64kb.mp3' },
  { label: 'Big Buck Bunny (Trailer MP4)', path: '/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4' },
  { label: 'Archive Details Metadata', path: '/metadata/BigBuckBunny_328' },
  { label: 'Traversal Test (Should Reject 400)', path: '/../../etc/passwd' },
  { label: 'Scheme Injection Test (Should Reject 400)', path: '/https://external.com' },
];

export function ProxyTester() {
  const [customPath, setCustomPath] = useState<string>('/download/BigBuckBunny_328/BigBuckBunny_512kb.mp4');
  const [probing, setProbing] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeMediaUrl, setActiveMediaUrl] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleProbe = async (pathToCheck: string) => {
    setProbing(true);
    setProbeResult(null);
    const startTime = Date.now();
    try {
      const res = await fetch(`/api/archive/metadata?path=${encodeURIComponent(pathToCheck)}`);
      const latencyMs = Date.now() - startTime;
      const data = await res.json();
      setProbeResult({
        path: pathToCheck,
        status: res.status,
        ok: res.ok,
        contentType: data.contentType,
        contentLength: data.contentLength,
        acceptRanges: data.acceptRanges,
        proxyUrl: `/api/archive/proxy?path=${encodeURIComponent(pathToCheck)}`,
        latencyMs,
        error: data.error,
      });
    } catch (err: any) {
      setProbeResult({
        path: pathToCheck,
        status: 500,
        ok: false,
        proxyUrl: '',
        latencyMs: Date.now() - startTime,
        error: err.message,
      });
    } finally {
      setProbing(false);
    }
  };

  const handlePlay = (targetPath: string) => {
    const url = `/api/archive/proxy?path=${encodeURIComponent(targetPath)}`;
    setActiveMediaUrl(url);
    setIsPlaying(true);
  };

  return (
    <div id="proxy-tester-panel" className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-6 backdrop-blur">
      <div className="flex items-center justify-between border-b border-neutral-800/80 pb-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-100">Live Media & Proxy Inspector</h2>
          <p className="text-xs text-neutral-400">Probe archive media paths, test stream chunking, or simulate validator attacks</p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {/* Preset quick buttons */}
        <div>
          <label className="text-xs font-medium text-neutral-400">Quick Test Cases:</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {SAMPLE_PATHS.map((item, idx) => (
              <button
                key={idx}
                id={`sample-path-btn-${idx}`}
                onClick={() => {
                  setCustomPath(item.path);
                  handleProbe(item.path);
                }}
                className="rounded-lg border border-neutral-800 bg-neutral-950/80 px-3 py-1.5 text-xs text-neutral-300 transition hover:border-neutral-700 hover:bg-neutral-800 cursor-pointer"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Path Input Form */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              id="custom-path-input"
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="/download/... or /metadata/..."
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono text-xs"
            />
          </div>
          <div className="flex gap-2">
            <button
              id="probe-path-btn"
              onClick={() => handleProbe(customPath)}
              disabled={probing || !customPath}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-50 cursor-pointer"
            >
              {probing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Probe Path
            </button>
            <button
              id="stream-proxy-btn"
              onClick={() => handlePlay(customPath)}
              disabled={!customPath}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-sky-500 active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" />
              Stream via Proxy
            </button>
          </div>
        </div>

        {/* Probe Response Details */}
        {probeResult && (
          <div
            id="probe-result-box"
            className={`rounded-lg border p-4 text-xs font-mono transition ${
              probeResult.ok
                ? 'border-emerald-800/80 bg-emerald-950/20 text-emerald-300'
                : 'border-rose-800/80 bg-rose-950/20 text-rose-300'
            }`}
          >
            <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                {probeResult.ok ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-rose-400" />
                )}
                <span className="font-semibold uppercase">
                  Status: {probeResult.status} {probeResult.ok ? 'Verified Clean' : 'Rejected / Error'}
                </span>
              </div>
              <span className="text-neutral-400">{probeResult.latencyMs}ms latency</span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-1.5 text-neutral-300 sm:grid-cols-2">
              <div><span className="text-neutral-500">Path:</span> {probeResult.path}</div>
              <div><span className="text-neutral-500">Content-Type:</span> {probeResult.contentType || 'N/A'}</div>
              <div><span className="text-neutral-500">Content-Length:</span> {probeResult.contentLength ? `${(parseInt(probeResult.contentLength) / (1024 * 1024)).toFixed(2)} MB` : 'N/A'}</div>
              <div><span className="text-neutral-500">Range Support:</span> {probeResult.acceptRanges || 'bytes'}</div>
            </div>

            {probeResult.error && (
              <div className="mt-2 text-rose-400">
                <span className="font-semibold text-rose-300">Error:</span> {probeResult.error}
              </div>
            )}
          </div>
        )}

        {/* Live Stream / Player preview */}
        {isPlaying && activeMediaUrl && (
          <div id="media-stream-container" className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-sky-400" />
                <span className="text-xs font-semibold text-neutral-200">Active Proxy Stream Playback</span>
              </div>
              <span className="rounded bg-sky-950 px-2 py-0.5 text-[10px] font-mono text-sky-400 border border-sky-800/60">
                Streamed through /api/archive/proxy
              </span>
            </div>

            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-neutral-900 border border-neutral-800">
              <video
                ref={videoRef}
                id="proxy-video-player"
                controls
                autoPlay
                className="h-full w-full object-contain"
                src={activeMediaUrl}
              >
                Your browser does not support HTML5 video streaming.
              </video>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
