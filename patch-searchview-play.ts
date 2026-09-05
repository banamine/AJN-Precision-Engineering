import fs from "fs";

let content = fs.readFileSync("src/components/SearchView.tsx", "utf-8");

const target = `<h4 className="text-xs font-medium text-neutral-300 mb-2">Channel Built Successfully</h4>`;
const replacement = `<div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-neutral-300">Channel Built Successfully</h4>
                <button
                  onClick={() => onPlayProgram(builtAssets[0]?.mediaUrl, builtAssets[0]?.title, "Cinema Vault", "video", "cinema-vault", "cable-tv")}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 transition"
                >
                  Tune In Now
                </button>
              </div>`;

content = content.replace(target, replacement);
fs.writeFileSync("src/components/SearchView.tsx", content);
