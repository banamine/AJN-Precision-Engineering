import { useState } from 'react';
import { RESOLVE_FAILURE_TEXT } from '../news/contract';
import { resolveNewsOnServer } from '../news/client';
import { appliableRows, applyPlan, parseExport, withLookup, type ImportPlan, type ImportRow } from '../news/importer';
import type { RumbleBaseline } from '../rumble/types';

interface Props {
  baseline: RumbleBaseline;
  hasSavedList: boolean;
  onApply: (next: RumbleBaseline) => void;
  onResetSaved: () => void;
}

const STATUS_TEXT: Record<ImportRow['status'], string> = {
  changed: 'CHANGED',
  new: 'NEW',
  unchanged: 'UNCHANGED',
  unresolved: 'LOOKUP FAILED',
};

const STATUS_CLASS: Record<ImportRow['status'], string> = {
  changed: 'bg-sky-500/15 text-sky-300',
  new: 'bg-emerald-500/15 text-emerald-300',
  unchanged: 'bg-neutral-700/40 text-neutral-400',
  unresolved: 'bg-red-500/15 text-red-300',
};

function shortDate(iso: string | null | undefined): string {
  const time = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'no date';
}

export function RumbleImportBox({ baseline, hasSavedList, onApply, onResetSaved }: Props) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const preview = async () => {
    setMessage(null);
    const parsed = parseExport(text, baseline);
    setPlan(parsed);
    if (!parsed.ok) return;
    setBusy(true);
    // Page ids are not embed ids, so each new/changed channel is looked up one at a time.
    let rows = parsed.rows;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.status === 'unchanged' || row.embedId) continue;
      const result = await resolveNewsOnServer(row.pageUrl);
      const updated = 'media' in result
        ? withLookup(row, { media: result.media })
        : withLookup(row, { reason: RESOLVE_FAILURE_TEXT[result.reason] });
      rows = rows.map((entry, i) => (i === index ? updated : entry));
      setPlan({ ...parsed, rows });
    }
    setBusy(false);
  };

  const apply = () => {
    if (!plan) return;
    try {
      const next = applyPlan(baseline, plan);
      onApply(next);
      const count = appliableRows(plan.rows).length;
      setMessage(`Applied ${count} channel${count === 1 ? '' : 's'}. The pickers now use the new links.`);
      setPlan(null);
      setText('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not apply that list.');
    }
  };

  const ready = plan ? appliableRows(plan.rows).length : 0;

  return (
    <details className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-neutral-100">Update channel list (paste export JSON)</summary>
      <div className="mt-3 flex flex-col gap-3 text-xs text-neutral-400">
        <p>
          On a Rumble channel's videos page in your own browser, run <code className="text-neutral-200">tools/export-rumble.js</code> in the
          console, then paste the JSON it copied below. You see what changes before anything is applied. The result is saved in this
          browser only.
        </p>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          placeholder="Paste the export JSON here"
          aria-label="Export JSON"
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 p-2 font-mono text-[11px] text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void preview()}
            disabled={busy || text.trim().length === 0}
            className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            {busy ? 'Checking links…' : 'Preview changes'}
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || ready === 0}
            className="rounded-md border border-sky-600 bg-sky-600/20 px-3 py-1 text-xs text-sky-200 hover:bg-sky-600/30 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            Apply {ready > 0 ? `(${ready})` : ''}
          </button>
          {hasSavedList && (
            <button
              type="button"
              onClick={onResetSaved}
              className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              Use built-in list
            </button>
          )}
        </div>

        {message && <p className="text-emerald-300" role="status">{message}</p>}
        {plan && plan.errors.map((error) => <p key={error} className="text-red-400" role="alert">{error}</p>)}

        {plan && plan.rows.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Import preview">
            {plan.rows.map((row) => (
              <li key={row.channelId} className="rounded-md border border-neutral-800 bg-neutral-950 p-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-neutral-100">{row.channelName}</span>
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${STATUS_CLASS[row.status]}`}>{STATUS_TEXT[row.status]}</span>
                  {row.candidate.state === 'live' && <span className="font-mono text-[10px] text-red-300">LIVE</span>}
                </div>
                {row.current && <p className="truncate" title={row.current.title}>Now: {row.current.title} <span className="text-neutral-500">(as of {shortDate(row.current.asOf)})</span></p>}
                <p className="truncate" title={row.candidate.title}>
                  New: {row.candidate.title}{' '}
                  <span className="text-neutral-500">({row.candidate.state === 'live' ? `started ${shortDate(row.candidate.startedAt)}` : `posted ${shortDate(row.candidate.publishedAt)}`})</span>
                </p>
                {row.note && <p className="text-red-400">{row.note} Not applied.</p>}
              </li>
            ))}
          </ul>
        )}

        {plan && plan.ok && (
          <p>
            {plan.untouchedChannels} other channel{plan.untouchedChannels === 1 ? '' : 's'} not in this export stay as they are.
            {plan.unknownHandles.length > 0 && ` Not in the News Wall list, so skipped: ${plan.unknownHandles.join(', ')}.`}
            {plan.invalidItems > 0 && ` ${plan.invalidItems} item${plan.invalidItems === 1 ? '' : 's'} could not be read (${plan.invalidSamples.join('; ')}).`}
          </p>
        )}
      </div>
    </details>
  );
}
