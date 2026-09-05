import fs from "fs";

let content = fs.readFileSync("src/components/SearchView.tsx", "utf-8");

const stateBlockStart = content.indexOf("const [query, setQuery] = useState");
const stateBlockAddition = `  const [buildStatus, setBuildStatus] = useState<string>('');
  const [builtAssets, setBuiltAssets] = useState<any[]>([]);

  const handleBuildChannel = async () => {
    setBuildStatus('building');
    try {
      const res = await fetch('/api/channels/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query || selectedNetwork, channelId: 'cinema-vault', channelName: query || 'Archive Discovery' })
      });
      const data = await res.json();
      setBuiltAssets(data.playlist || []);
      setBuildStatus('done');
    } catch (e) {
      setBuildStatus('error');
    }
  };
`;

content = content.substring(0, stateBlockStart) + stateBlockAddition + content.substring(stateBlockStart);

const buttonAddition = `
      {/* ── Channel Builder Panel ────────────────────────────────────────── */}
      {hasSearched && !loading && (
        <div className="rounded-xl border border-purple-800/50 bg-purple-900/10 p-5 mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-purple-200">Archive Discovery</h3>
              <p className="text-xs text-purple-400/80 mt-1">Convert these search results into a curated 24/7 channel.</p>
            </div>
            <button
              type="button"
              onClick={handleBuildChannel}
              disabled={buildStatus === 'building'}
              className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-purple-600/20 transition hover:bg-purple-500 active:scale-95 disabled:opacity-50"
            >
              {buildStatus === 'building' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {buildStatus === 'building' ? 'Building...' : 'Create 24/7 Channel'}
            </button>
          </div>
          
          {buildStatus === 'done' && (
            <div className="rounded border border-neutral-800 bg-neutral-900/50 p-4">
              <h4 className="text-xs font-medium text-neutral-300 mb-2">Channel Built Successfully</h4>
              <p className="text-[11px] text-neutral-500 mb-3">Extracted {builtAssets.length} playable media assets.</p>
              <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-2">
                {builtAssets.map((asset, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px] border-b border-neutral-800/50 pb-1">
                    <span className="text-neutral-300 truncate pr-2">{asset.title}</span>
                    <div className="flex gap-2 shrink-0">
                      <span className="text-purple-400 font-mono">[{asset.quality?.label}]</span>
                      <span className="text-neutral-500">{asset.category}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
`;

const resultsGridIndex = content.indexOf("{/* ── Results Grid ─────────────────────────────────────────────────── */}");
content = content.substring(0, resultsGridIndex) + buttonAddition + content.substring(resultsGridIndex);

fs.writeFileSync("src/components/SearchView.tsx", content);
