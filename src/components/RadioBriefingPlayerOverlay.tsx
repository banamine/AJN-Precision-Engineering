import { useRef } from "react";
import { Pause, Play } from "lucide-react";
import { useDigest } from "../hooks/useDigest";
import { useAutoScroll } from "../hooks/useAutoScroll";
import { digestNotice } from "../utils/newsDigest";
import { NewsTicker } from "./DailyBriefing";
import { LiveRadioNowPlaying } from "./LiveRadioNowPlaying";
import { LiveRadioStationCard } from "./LiveRadioStationCard";
import "../radio.css";

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Text-first Daily Briefing inside the existing live-radio audio stage. */
export function RadioBriefingPlayerOverlay({ stationId, logoUrl }: { stationId?: string | null; logoUrl?: string | null } = {}) {
  const news = useDigest();
  const digest = news.data?.digest ?? null;
  const notice = digest ? digestNotice(digest.updatedAt, Date.now(), news.error) : null;
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const auto = useAutoScroll(boxRef, contentRef, { enabled: !!digest, contentKey: digest });

  return (
    <div
      data-testid="radio-briefing-overlay"
      className="absolute inset-x-3 top-10 bottom-12 z-[2] overflow-hidden rounded-lg border border-neutral-700/80 bg-neutral-950/95 shadow-xl"
    >
      <section className="ajr h-full min-h-0 !p-3" aria-labelledby="radio-briefing-title">
        <div className="flex h-full min-h-0 flex-col gap-2">
          <LiveRadioStationCard stationId={stationId} />
          <LiveRadioNowPlaying stationId={stationId} logoUrl={logoUrl} />
          <header className="flex shrink-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="ajr-label">
                {digest?.date ? `THE DAILY BRIEFING · ${digest.date}` : "THE DAILY BRIEFING"}
              </div>
              <h2 id="radio-briefing-title" className="mt-1 hidden text-lg font-semibold leading-tight text-white sm:block">
                Daily news
              </h2>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              {digest?.updatedAt && (
                <span className="pt-1 text-right text-[10px] text-neutral-400">
                  Updated {timeLabel(digest.updatedAt)}
                </span>
              )}
              {digest && (
                <button
                  type="button"
                  data-testid="radio-briefing-autoscroll-toggle"
                  aria-pressed={!auto.paused}
                  aria-label={auto.paused ? "Start auto-scroll" : "Pause auto-scroll"}
                  onClick={() => auto.setPaused(!auto.paused)}
                  className="pointer-events-auto -mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-neutral-300 hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  {auto.paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
                </button>
              )}
            </div>
          </header>

          <div className="shrink-0">
            <NewsTicker news={news} />
          </div>

          {notice && <p role="status" className="ajr-status m-0 shrink-0 text-[10px]">{notice.text}</p>}

          <div
            ref={boxRef}
            role="region"
            aria-label="Daily briefing stories"
            tabIndex={0}
            className={`min-h-0 flex-1 pr-1 ${auto.manual ? "overflow-y-auto" : "overflow-hidden"}`}
            data-testid="radio-briefing-stories"
            data-autoscroll={auto.paused ? "paused" : auto.manual ? "manual" : "auto"}
            {...auto.containerProps}
          >
            <div ref={contentRef} data-testid="radio-briefing-content" className="space-y-2 will-change-transform">
            {!digest && news.phase === "loading" && (
              <p role="status" className="ajr-status">Loading the latest briefing…</p>
            )}
            {!digest && news.phase === "error" && (
              <p role="alert" className="ajr-status ajr-status-error">
                The Daily Briefing could not be loaded. Radio playback continues.
              </p>
            )}

            {digest?.briefing.map((block, index) => (
              <article key={`${index}-${block.headline}`} className="ajr-briefing-item !gap-1 !p-2">
                <span className="ajr-label">
                  {String(index + 1).padStart(2, "0")}{block.source ? ` · ${block.source.toUpperCase()}` : ""}
                  {block.theme ? ` · ${block.theme.toUpperCase()}` : ""}
                </span>
                <strong className="!text-xs">{block.headline}</strong>
                {block.summary && <p className="!text-[11px] !leading-snug">{block.summary}</p>}
              </article>
            ))}

            {digest && digest.briefing.length === 0 && digest.top.length > 0 && (
              <p className="ajr-status">The written briefing is unavailable; current headlines are below.</p>
            )}

            {digest?.top.map((item) => (
              <a
                key={item.id}
                className="ajr-news-card !gap-2 !p-2"
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="radio-briefing-headline"
              >
                <span className="ajr-news-body !gap-1">
                  <span className="ajr-news-meta">{item.source.toUpperCase()}</span>
                  <span className="ajr-news-title !text-xs !leading-snug">{item.title}</span>
                  {item.excerpt && <span className="ajr-news-excerpt !text-[10px] !leading-snug">{item.excerpt}</span>}
                </span>
              </a>
            ))}

            {digest && digest.top.length === 0 && digest.briefing.length === 0 && (
              <p className="ajr-status">No briefing stories are available right now.</p>
            )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
