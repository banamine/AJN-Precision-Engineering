import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Ban } from "lucide-react";
import { RumbleNewsWall } from "./RumbleNewsWall";
import { YoutubeWall } from "./YoutubeWall";
import { BannedVideoWall } from "./BannedVideoWall";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * News tabs. To add, remove or reorder a tab, edit NEWS_TABS only.
 * `hash` (optional) gives a tab its own deep link, e.g. #bannedvideo; selecting the tab writes it.
 */
export interface NewsTabConfig {
  id: string;
  label: string;
  /** Text for the ErrorBoundary that isolates this tab. */
  boundary: string;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  hash?: string;
  render: () => ReactNode;
}

export const NEWS_TABS: readonly NewsTabConfig[] = [
  { id: "rumble", label: "Rumble", boundary: "Rumble wall", render: () => <RumbleNewsWall /> },
  { id: "youtube", label: "YouTube", boundary: "YouTube wall", render: () => <YoutubeWall /> },
  { id: "bannedvideo", label: "BANNED VIDEO", boundary: "Banned Video wall", icon: Ban, hash: "bannedvideo", render: () => <BannedVideoWall /> },
];

const DEFAULT_TAB = NEWS_TABS[0].id;

/** Tab named by the URL: #<hash>, or the path /<hash> when there is no hash. Null = no deep link. */
export function tabFromLocation(location?: { hash: string; pathname: string }): string | null {
  const currentLocation = location ?? (typeof window === "undefined" ? null : window.location);
  if (!currentLocation) return null;
  const hash = currentLocation.hash.replace(/^#/, "").toLowerCase();
  const path = currentLocation.pathname.replace(/\/+$/, "").split("/").pop()?.toLowerCase() ?? "";
  const key = hash || path;
  return NEWS_TABS.find((tab) => tab.hash !== undefined && tab.hash === key)?.id ?? null;
}

export function NewsTabs() {
  const [activeTab, setActiveTab] = useState<string>(() => tabFromLocation() ?? DEFAULT_TAB);

  // Typing #bannedvideo while already on News switches the tab.
  useEffect(() => {
    const onHash = () => {
      const fromUrl = tabFromLocation();
      if (fromUrl) setActiveTab(fromUrl);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = (tab: NewsTabConfig) => {
    setActiveTab(tab.id);
    if (typeof window === "undefined") return;
    const wanted = `#${tab.hash ?? "news"}`;
    if (window.location.hash !== wanted) window.location.hash = wanted;
  };

  return (
    <section className="w-full" data-testid="news-tabs">
      <div className="mb-4 flex gap-2 border-b border-neutral-800" role="tablist" aria-label="News source">
        {NEWS_TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`news-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`news-panel-${tab.id}`}
              onClick={() => select(tab)}
              onKeyDown={(event) => {
                const currentIndex = NEWS_TABS.findIndex((item) => item.id === tab.id);
                let nextIndex = currentIndex;
                if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % NEWS_TABS.length;
                else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + NEWS_TABS.length) % NEWS_TABS.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = NEWS_TABS.length - 1;
                else return;
                event.preventDefault();
                const nextTab = NEWS_TABS[nextIndex];
                document.getElementById(`news-tab-${nextTab.id}`)?.focus();
                select(nextTab);
              }}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                selected ? "border-sky-400 text-neutral-100" : "border-transparent text-neutral-400 hover:text-neutral-200"
              }`}
              data-testid={`tab-${tab.id}`}
            >
              {Icon && <Icon className="h-4 w-4" aria-hidden />}
              {tab.label}
            </button>
          );
        })}
      </div>
      {NEWS_TABS.map((tab) => (
        <div
          key={tab.id}
          id={`news-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`news-tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          data-testid={`panel-${tab.id}`}
        >
          {activeTab === tab.id && <ErrorBoundary label={tab.boundary}>{tab.render()}</ErrorBoundary>}
        </div>
      ))}
    </section>
  );
}
