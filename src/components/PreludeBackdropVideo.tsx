import { useEffect, useRef, useState } from "react";

/** Backdrop sources. `youtube` is a reserved slot for later and is intentionally not rendered yet. */
export type BackdropSource =
  | { kind: "mp4"; src: string; poster?: string }
  | { kind: "youtube"; id: string };

interface PreludeBackdropVideoProps {
  source: BackdropSource;
  enabled: boolean;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Silent looping backdrop for archive-music mode. Decorative only: never produces sound, never touches Web Audio.
 * Reduced motion = poster frame only. Paused while the tab is hidden or the stage is off screen.
 * A load error renders nothing (no fake fallback).
 */
export function PreludeBackdropVideo({ source, enabled }: PreludeBackdropVideoProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  const active = enabled && source.kind === "mp4" && !failed && !reduced;
  const shouldPlay = active && onScreen && tabVisible;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, reduced]);

  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    if (shouldPlay) void v.play().catch(() => undefined); // autoplay refusal just leaves the poster showing
    else v.pause();
  }, [shouldPlay]);

  if (!enabled || source.kind !== "mp4" || failed) return null;
  return (
    <div ref={wrapRef} data-testid="prelude-backdrop" aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {reduced ? (
        source.poster ? <img src={source.poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.35]" /> : null
      ) : (
        <video
          ref={videoRef}
          src={source.src}
          poster={source.poster}
          muted
          loop
          autoPlay
          playsInline
          preload="auto"
          tabIndex={-1}
          disablePictureInPicture
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover opacity-[0.35]"
        />
      )}
      {/* dark scrim keeps title/artist text above WCAG AA over the bright glass tiles */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0.25) 30%, rgba(0,0,0,0.55) 90%)" }} />
    </div>
  );
}
