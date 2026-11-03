import React, { useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { AjnAppearanceProvider } from "./src/components/ajn-platform-redesign/AppearanceProvider";
import { Navigation } from "./src/components/Navigation";
import { PlayerView } from "./src/components/PlayerView";
import type { Destination, NowPlayingMedia } from "./src/types";
import "./src/index.css";

type Scenario = "cc5" | "align" | "asr" | "none" | "ineligible" | "live" | "nonarchive" | "movie" | "radio";
const params = new URLSearchParams(window.location.search);
const scenario = (params.get("scenario") ?? "cc5") as Scenario;
const route = (params.get("route") ?? "player") as Destination;
const eligibleNews = ["cc5", "align", "asr", "none"].includes(scenario);
const isRadio = scenario === "radio";
const isLive = scenario === "live";
const archivePath = eligibleNews
  ? "/download/CNNW_20261101_080000_CNNW/CNNW_20261101_080000_CNNW.mp4?exact=1&start=0&end=300"
  : scenario === "movie" ? "/download/film-sample/film-sample.mp4" : undefined;

const nowPlaying: NowPlayingMedia = {
  src: isLive ? "/synthetic-live-source.mp4" : "/synthetic-test-media.mp4",
  title: `SYNTHETIC TEST — ${scenario.toUpperCase()} fixture`,
  subtitle: "Synthetic player layout; no media bytes are loaded",
  mediaType: isRadio ? "audio" : "video",
  channelId: isRadio ? "archive-infowars-radio" : eligibleNews ? "cnn" : isLive ? "pluto:synthetic-live" : "synthetic-non-news",
  guideId: eligibleNews || isLive ? "cable-tv" : isRadio ? "audio-podcasts" : scenario === "movie" ? "movies-classics-vault" : "classic-tv",
  archivePath,
};

function TestShell() {
  const shellRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const header = shell?.querySelector<HTMLElement>("#canonical-app-header");
    if (!shell || !header) return;
    const bottomNav = shell.querySelector<HTMLElement>("#mobile-bottom-nav");
    const update = () => {
      const headerHeight = header.getBoundingClientRect().height;
      const bottomNavHeight = bottomNav && getComputedStyle(bottomNav).display !== "none"
        ? bottomNav.getBoundingClientRect().height
        : 0;
      if (headerHeight > 0) {
        shell.style.setProperty("--ajn-header-h", `${headerHeight}px`);
        shell.style.setProperty("--ajn-nav-h", `${headerHeight + bottomNavHeight}px`);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    if (bottomNav) observer.observe(bottomNav);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const playerRoute = route === "player";
  const constrainedPlayerPage = playerRoute && !isRadio;
  const onNavigate = (_destination: Destination) => {};
  return (
    <AjnAppearanceProvider>
      <div ref={shellRef} id="canonical-app-shell" className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
        <Navigation currentDestination={route} onNavigate={onNavigate} nowPlaying={nowPlaying} />
        <main id="canonical-main-viewport" className={constrainedPlayerPage
          ? "ajn-player-main flex-1 min-h-0 w-full px-3 sm:px-6 lg:px-8 lg:max-w-none lg:pt-3 lg:pb-3"
          : playerRoute
            ? "mx-auto w-full max-w-7xl flex-1 px-3 pb-20 pt-4 sm:px-6 sm:pt-8 lg:px-8"
            : "mx-auto min-h-[140vh] w-full max-w-7xl flex-1 px-3 pb-20 pt-4 sm:px-6 sm:pt-8 lg:px-8"}>
          {!playerRoute && <div data-testid={`page-${route}`} className="min-h-[130vh] rounded-lg border border-neutral-800 p-4">Synthetic {route} page scroll fixture</div>}
          <div id="persistent-player" hidden={!playerRoute} className={`h-full min-h-0 w-full ${playerRoute ? "view-fade-in" : ""}`}>
            <PlayerView nowPlaying={nowPlaying} onNavigate={onNavigate} onToggleFavorite={() => {}} />
          </div>
        </main>
        {!playerRoute && <div data-testid="mini-player-dock" className="fixed bottom-2 right-2 z-50 rounded bg-neutral-800 px-3 py-2 text-xs">Synthetic dock visibility fixture</div>}
        <div data-testid="synthetic-fixture-label" className="fixed right-2 top-[calc(var(--ajn-header-h,56px)+4px)] z-[60] rounded bg-amber-700 px-2 py-1 text-[10px] font-bold uppercase text-white">
          Synthetic playback and caption fixtures — no Archive requests
        </div>
      </div>
    </AjnAppearanceProvider>
  );
}

createRoot(document.getElementById("root")!).render(<TestShell />);
