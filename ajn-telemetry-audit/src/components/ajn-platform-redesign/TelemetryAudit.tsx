import { useEffect, useMemo, useState } from 'react';
import { Activity, Copy } from 'lucide-react';
import { getBufferSamples, type BufferSampleLogEntry } from '../../telemetry';
import { auditFindings, summarizeSamples, type AuditSummary } from '../../utils/telemetryAudit';

const f1 = (n: number | null) => (n === null ? '—' : n.toFixed(1));

function Sparkline({ summary }: { summary: AuditSummary }) {
  const { ahead, chunkAt } = summary;
  if (ahead.length < 2) return null;
  const W = 240; const H = 56; const pad = 4;
  const top = Math.max(30, ...ahead);
  const x = (i: number) => pad + (i / (ahead.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (Math.max(0, v) / top) * (H - pad * 2);
  const points = ahead.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="ajn-audit-spark" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Seconds of video buffered ahead, last ${ahead.length} samples, from ${f1(summary.aheadMin)} to ${f1(summary.aheadMax)} seconds`}>
      <line x1={pad} x2={W - pad} y1={y(10)} y2={y(10)} className="ajn-audit-spark-floor" />
      <polyline points={points} className="ajn-audit-spark-line" fill="none" />
      {chunkAt.map((hit, i) => (hit ? <circle key={i} cx={x(i)} cy={y(ahead[i])} r="2.4" className="ajn-audit-spark-chunk" /> : null))}
    </svg>
  );
}

export function TelemetryAudit() {
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<BufferSampleLogEntry[]>([]);
  const [exportState, setExportState] = useState<'idle' | 'copied' | 'downloaded'>('idle');

  // Polls the real in-memory ring only while the section is open.
  useEffect(() => {
    if (!open) return;
    const read = () => setSamples(getBufferSamples());
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const summary = useMemo(() => summarizeSamples(samples), [samples]);
  const findings = useMemo(() => auditFindings(summary), [summary]);

  const exportJson = async () => {
    const { ahead: _a, chunkAt: _c, ...flat } = summary;
    const text = JSON.stringify({ exportedAt: new Date().toISOString(), summary: flat, findings, samples }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setExportState('copied');
    } catch {
      try {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = `ajn-telemetry-audit-${Date.now()}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        setExportState('downloaded');
      } catch { setExportState('idle'); }
    }
    window.setTimeout(() => setExportState('idle'), 2500);
  };

  const fs = summary.fetchSeconds;
  return (
    <section className="ajn-audit" aria-labelledby="ajn-audit-title">
      <button type="button" className="ajn-audit-toggle" aria-expanded={open} aria-controls="ajn-audit-body" onClick={() => setOpen((v) => !v)}>
        <Activity size={16} aria-hidden="true" />
        <span id="ajn-audit-title">Telemetry Audit</span>
        <span className="ajn-audit-hint">{open ? 'Hide' : 'Live buffer evidence'}</span>
      </button>
      {open && (
        <div id="ajn-audit-body" className="ajn-audit-body">
          <p className="ajn-audit-note">Real samples from the player, kept in memory only (last 120, lost on reload). Nothing here is simulated.</p>
          <dl className="ajn-audit-grid">
            <div><dt>Samples</dt><dd>{summary.sampleCount} · {f1(summary.spanSeconds)} s</dd></div>
            <div><dt>Cushion min / median / max</dt><dd>{f1(summary.aheadMin)} / {f1(summary.aheadMedian)} / {f1(summary.aheadMax)} s</dd></div>
            <div><dt>Chunks landed</dt><dd>{summary.chunkCount} · {f1(summary.chunkSeconds)} s of media</dd></div>
            <div><dt>Underruns</dt><dd>{summary.underrunCount}{summary.underrunCount ? ` · longest ${f1(summary.longestUnderrunMs / 1000)} s` : ''}</dd></div>
            <div><dt>Bitrate need</dt><dd>{summary.kbpsNeeded === null ? 'unknown (no metadata)' : `${(summary.kbpsNeeded / 1000).toFixed(2)} Mbit/s`}</dd></div>
            <div><dt>Fetch time</dt><dd>{summary.hasFetchState ? `load ${f1(fs.loading)} · held ${f1(fs.suspended)} · starved ${f1(fs.starved)} s` : 'not recorded (older build)'}</dd></div>
          </dl>
          {summary.mediaPath && <p className="ajn-audit-path" title={summary.mediaPath}>{summary.mediaPath}</p>}
          <Sparkline summary={summary} />
          <ul className="ajn-audit-findings">
            {findings.map((f, i) => (
              <li key={i} className={`is-${f.level}`}>
                <strong>{f.title}</strong>
                <span>{f.detail}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="ajn-audit-export" onClick={exportJson} disabled={summary.sampleCount === 0}>
            <Copy size={15} aria-hidden="true" />
            {exportState === 'copied' ? 'Copied JSON' : exportState === 'downloaded' ? 'Downloaded JSON' : 'Copy audit JSON'}
          </button>
        </div>
      )}
    </section>
  );
}
