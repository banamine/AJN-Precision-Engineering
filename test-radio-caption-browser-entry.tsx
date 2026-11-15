import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./src/index.css";
import { CaptionPanel } from "./src/news/captions/CaptionPanel";
import { RadioCaptionPanel } from "./src/news/captions/RadioCaptionPanel";
import { RADIO_FIXTURE_ID } from "./test-radio-caption-fixtures";

declare global {
  interface Window {
    __captionDemo?: {
      setTime: (seconds: number) => void;
      setPaused: (paused: boolean) => void;
      time: () => number;
    };
  }
}

const query = new URLSearchParams(window.location.search);
const mode = query.get("mode") ?? "radio";
const identifier = query.get("id") ?? RADIO_FIXTURE_ID;
const archivePath = "/download/CNNW_20261016_030000_Newsroom/CNNW_20261016_030000_Newsroom.mp4?exact=1&start=0&end=282";
const fakeMedia = { currentTime: 10, paused: false };

function CaptionDemo() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(10);
  const useFake = mode === "e3";
  const getMedia = () => useFake ? fakeMedia as HTMLAudioElement : audioRef.current;
  const getVideo = () => getMedia() as unknown as HTMLVideoElement | null;
  const setPosition = (seconds: number) => {
    if (useFake) fakeMedia.currentTime = seconds;
    else if (audioRef.current && seconds < 10) audioRef.current.currentTime = seconds;
    setTime(seconds);
  };
  const setPaused = (paused: boolean) => {
    if (useFake) fakeMedia.paused = paused;
    else if (paused) void audioRef.current?.pause();
    else void audioRef.current?.play().catch(() => {});
  };

  useEffect(() => {
    window.__captionDemo = { setTime: setPosition, setPaused, time: () => useFake ? fakeMedia.currentTime : audioRef.current?.currentTime ?? 0 };
    if (!useFake) void audioRef.current?.play().catch(() => {});
    return () => { delete window.__captionDemo; };
  }, [useFake]);

  const content = mode === "news"
    ? <CaptionPanel nowPlaying={{ archivePath } as any} getVideo={getVideo} />
    : mode === "compare"
      ? <div className="space-y-3">
          <div data-testid="radio-compare"><RadioCaptionPanel identifier={RADIO_FIXTURE_ID} getAudio={getMedia} /></div>
          <div data-testid="news-compare"><CaptionPanel nowPlaying={{ archivePath } as any} getVideo={getVideo} /></div>
        </div>
      : <RadioCaptionPanel identifier={identifier} getAudio={getMedia} />;

  return (
    <main className="min-h-screen bg-neutral-900 p-4 text-neutral-100">
      <h1 className="mb-3 text-base font-semibold">DEMO — synthetic caption fixture</h1>
      {!useFake && <audio ref={audioRef} className="w-full max-w-3xl" controls preload="auto" src="/stub.wav" data-testid="stub-audio" aria-label="Synthetic 10-second silent audio" />}
      {useFake && <div className="mb-3 rounded border border-neutral-700 p-2 text-xs text-neutral-300" data-testid="stub-audio">DEMO — fake media playhead · 10-second fixture</div>}
      <p className="mb-3 text-xs text-neutral-400" data-testid="playhead-readout">DEMO playhead: {time.toFixed(1)} s</p>
      {content}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<CaptionDemo />);
