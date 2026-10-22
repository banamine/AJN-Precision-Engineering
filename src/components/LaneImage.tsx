import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { enqueueThumbnailLoad } from '../utils/thumbnailLane';

interface LaneImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  referrerPolicy?: React.ImgHTMLAttributes<HTMLImageElement>['referrerPolicy'];
  draggable?: boolean;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
  'data-testid'?: string;
  'data-thumb-source'?: string;
  'data-lane-src'?: string;
  'aria-hidden'?: boolean;
  style?: React.CSSProperties;
}

/** Lazy, low-priority image that must acquire a browser-wide thumbnail slot before its src is assigned. */
export function LaneImage({
  src,
  alt,
  className = '',
  referrerPolicy,
  draggable,
  onLoad,
  onError,
  style,
  ...dataProps
}: LaneImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const leaseRef = useRef<{ src: string; release: () => void } | null>(null);
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === 'undefined');
  const [permittedSrc, setPermittedSrc] = useState<string | null>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (nearViewport || !image) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '300px' });
    observer.observe(image);
    return () => observer.disconnect();
  }, [nearViewport]);

  useEffect(() => {
    setPermittedSrc(null);
    if (!src || !nearViewport) return;
    let active = true;
    const cancel = enqueueThumbnailLoad((release) => {
      leaseRef.current = { src, release };
      if (active) setPermittedSrc(src);
      else release();
    });
    return () => {
      active = false;
      cancel();
      if (leaseRef.current?.src === src) {
        leaseRef.current.release();
        leaseRef.current = null;
      }
    };
  }, [src, nearViewport]);

  const finish = (event: SyntheticEvent<HTMLImageElement>, callback?: (event: SyntheticEvent<HTMLImageElement>) => void) => {
    if (leaseRef.current?.src === src) {
      leaseRef.current.release();
      leaseRef.current = null;
    }
    callback?.(event);
  };

  return (
    <img
      ref={imageRef}
      src={permittedSrc === src ? src : undefined}
      alt={alt}
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      referrerPolicy={referrerPolicy}
      draggable={draggable}
      onLoad={(event) => finish(event, onLoad)}
      onError={(event) => finish(event, onError)}
      aria-busy={Boolean(src && permittedSrc !== src)}
      style={style}
      {...dataProps}
      className={className}
    />
  );
}
