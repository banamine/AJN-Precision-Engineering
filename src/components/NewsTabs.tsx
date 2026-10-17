import { useState } from "react";
import { RumbleNewsWall } from "./RumbleNewsWall";
import { YoutubeWall } from "./YoutubeWall";
import { ErrorBoundary } from "./ErrorBoundary";

type NewsTab = "rumble" | "youtube";

export function NewsTabs() {
  const [activeTab, setActiveTab] = useState<NewsTab>("rumble");

  return (
    <section className="w-full" data-testid="news-tabs">
      <div className="mb-4 flex gap-2 border-b border-neutral-800" role="tablist" aria-label="News source">
        <button
          type="button"
          role="tab"
          id="news-tab-rumble"
          aria-selected={activeTab === "rumble"}
          aria-controls="news-panel-rumble"
          onClick={() => setActiveTab("rumble")}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
            activeTab === "rumble"
              ? "border-sky-400 text-neutral-100"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
          data-testid="tab-rumble"
        >
          Rumble
        </button>
        <button
          type="button"
          role="tab"
          id="news-tab-youtube"
          aria-selected={activeTab === "youtube"}
          aria-controls="news-panel-youtube"
          onClick={() => setActiveTab("youtube")}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
            activeTab === "youtube"
              ? "border-sky-400 text-neutral-100"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
          data-testid="tab-youtube"
        >
          YouTube
        </button>
      </div>
      <div
        id="news-panel-rumble"
        role="tabpanel"
        aria-labelledby="news-tab-rumble"
        hidden={activeTab !== "rumble"}
        data-testid="panel-rumble"
      >
        {activeTab === "rumble" && <ErrorBoundary label="Rumble wall"><RumbleNewsWall /></ErrorBoundary>}
      </div>
      <div
        id="news-panel-youtube"
        role="tabpanel"
        aria-labelledby="news-tab-youtube"
        hidden={activeTab !== "youtube"}
        data-testid="panel-youtube"
      >
        {activeTab === "youtube" && <ErrorBoundary label="YouTube wall"><YoutubeWall /></ErrorBoundary>}
      </div>
    </section>
  );
}
