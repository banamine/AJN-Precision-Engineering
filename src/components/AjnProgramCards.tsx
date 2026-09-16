import { Play, ArrowRight } from "lucide-react";
import type { AjnCategoryDestination, AjnMediaRecord } from "../contracts/ajn-media";
import { AJN_VISUAL_ASSET_MAP } from "../contracts/ajn-visual-assets";
import type { PlayProgramCallback } from "../types";

interface AjnProgramCardsProps {
  programs: readonly AjnMediaRecord[];
  categories?: readonly AjnCategoryDestination[];
  onPlayProgram: PlayProgramCallback;
  onBrowseCategory?: (destination: AjnCategoryDestination) => void;
  loading?: boolean;
  error?: string | null;
}

function formatDate(value?: number): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

const FALLBACK_ART =
  "linear-gradient(135deg, rgba(8,47,73,0.95), rgba(15,23,42,0.98))";

function ProgramArtwork({ program }: { program: AjnMediaRecord }) {
  const imageUrl = program.visualAssetKey
    ? AJN_VISUAL_ASSET_MAP[program.visualAssetKey]?.imageUrl
    : undefined;

  return imageUrl ? (
    <img
      src={imageUrl}
      alt=""
      loading="lazy"
      className="absolute inset-0 h-full w-full object-cover"
      onError={(event) => {
        event.currentTarget.style.display = "none";
        event.currentTarget.parentElement?.setAttribute("data-art-fallback", "true");
      }}
    />
  ) : (
    <div aria-hidden="true" className="absolute inset-0" style={{ background: FALLBACK_ART }} />
  );
}

function SkeletonRow() {
  return (
    <div
      aria-label="Loading recent programs"
      className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="min-w-[250px] sm:min-w-[280px] snap-start overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/70 min-h-40 animate-pulse"
        />
      ))}
    </div>
  );
}

export function AjnProgramCards({
  programs,
  categories = [],
  onPlayProgram,
  onBrowseCategory,
  loading = false,
  error = null,
}: AjnProgramCardsProps) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="ajn-recent-programs-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="ajn-recent-programs-heading" className="text-lg font-semibold tracking-tight text-neutral-100">
            Recent Programs
          </h2>
          <span className="text-xs text-neutral-500">
            {loading ? "Loading" : `${programs.length} available`}
          </span>
        </div>

        {loading ? (
          <SkeletonRow />
        ) : error ? (
          <div role="alert" className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            Recent programs are temporarily unavailable.
          </div>
        ) : programs.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-6 text-sm text-neutral-400">
            No recent programs are available yet.
          </div>
        ) : (
          <div
            aria-label="Recent programs"
            className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2"
          >
            {programs.map((program) => {
              const actionLabel = program.playable
                ? `Play ${program.title}`
                : `Browse ${program.category || program.title}`;

              return (
                <article
                  key={program.id}
                  className="group relative min-w-[250px] sm:min-w-[280px] snap-start overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/70 min-h-40"
                >
                  <ProgramArtwork program={program} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent pointer-events-none" />
                  <div className="relative z-10 flex min-h-40 flex-col justify-end p-4">
                    <div className="text-[11px] uppercase tracking-wide text-sky-300/90">
                      {program.category || program.sourceKind}
                    </div>
                    <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-white">{program.title}</h3>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-[11px] text-neutral-300">{formatDate(program.startTime)}</span>
                      {program.playable ? (
                        <button
                          type="button"
                          aria-label={actionLabel}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                          onClick={() => {
                            if (!program.playbackUrl) return;
                            onPlayProgram(
                              program.playbackUrl,
                              program.title,
                              program.category,
                              program.mediaType,
                              program.channelId,
                              program.guideId,
                              program.programId,
                            );
                          }}
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                          Play
                        </button>
                      ) : (
                        <span
                          role="status"
                          aria-label={actionLabel}
                          className="rounded-lg border border-neutral-700 px-2.5 py-1.5 text-[11px] font-medium text-neutral-300"
                        >
                          Browse
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {categories.length > 0 && (
        <section aria-labelledby="ajn-featured-coverage-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="ajn-featured-coverage-heading" className="text-lg font-semibold tracking-tight text-neutral-100">
              Featured Coverage
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {categories.map((category) => (
              <button
                key={category.key}
                type="button"
                aria-label={`Browse ${category.title}`}
                onClick={() => onBrowseCategory?.(category)}
                className="group flex min-h-28 items-end rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 text-left hover:border-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span>
                    <span className="block text-sm font-semibold text-white">{category.title}</span>
                    <span className="block text-[11px] text-neutral-400">{category.category}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-sky-400 transition group-hover:translate-x-0.5" />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
