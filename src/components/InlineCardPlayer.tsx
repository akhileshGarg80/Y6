import React, {useEffect, useRef, useState} from 'react';
import {ExternalLink, WifiOff, X} from 'lucide-react';
import {CachedThumbnail} from './CachedThumbnail';

interface YTPlayerLite {
  playVideo: () => void;
  destroy: () => void;
}

interface InlineCardPlayerProps {
  videoId: string;
  title: string;
  isOnline: boolean;
  onStop: () => void;
  onPlayStarted?: () => void;
  compact?: boolean;
}

const VIRTUAL_STAGE_W = 480;
const VIRTUAL_STAGE_H = 270;

export const InlineCardPlayer: React.FC<InlineCardPlayerProps> = ({
  videoId,
  title,
  isOnline,
  onStop,
  onPlayStarted,
  compact = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerLite | null>(null);
  const onPlayStartedRef = useRef(onPlayStarted);
  onPlayStartedRef.current = onPlayStarted;

  const [embedError, setEmbedError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Measure card box width so small cards proportionally scale down the full 16:9 YouTube player
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setContainerWidth(rect.width);
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mount YouTube IFrame API right inside this card box
  useEffect(() => {
    if (!isOnline) return;

    let cancelled = false;
    setEmbedError(null);

    const mountPlayer = () => {
      if (cancelled || !hostRef.current || !window.YT?.Player) return;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore
        }
      }

      hostRef.current.innerHTML = '';
      const node = document.createElement('div');
      node.style.width = '100%';
      node.style.height = '100%';
      hostRef.current.appendChild(node);

      playerRef.current = new (window.YT.Player as unknown as new (
        el: HTMLElement,
        opts: Record<string, unknown>
      ) => YTPlayerLite)(node, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e: {target: YTPlayerLite}) => {
            if (!cancelled) {
              try {
                e.target.playVideo();
              } catch {
                // Ignore
              }
            }
          },
          onStateChange: (e: {data: number}) => {
            if (!cancelled && e.data === 1) {
              onPlayStartedRef.current?.();
            }
          },
          onError: (e: {data: number}) => {
            if (cancelled) return;
            if (e.data === 101 || e.data === 150) {
              setEmbedError('Embed disabled by owner');
            } else if (e.data === 100) {
              setEmbedError('Video unavailable');
            } else {
              setEmbedError('Playback error');
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      mountPlayer();
    } else {
      const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existing) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prev) prev();
        mountPlayer();
      };
    }

    return () => {
      cancelled = true;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore
        }
        playerRef.current = null;
      }
    };
  }, [videoId, isOnline]);

  const shouldScaleDown = containerWidth > 0 && containerWidth < 440;
  const scaleRatio = shouldScaleDown ? containerWidth / VIRTUAL_STAGE_W : 1;

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black overflow-hidden">
      {!isOnline ? (
        <div className="relative w-full h-full flex flex-col items-center justify-center p-2 text-center text-white">
          <CachedThumbnail
            videoId={videoId}
            alt={title}
            isOnline={false}
            className="absolute inset-0 w-full h-full opacity-35"
          />
          <WifiOff className="relative z-10 w-4 h-4 text-amber-400 mb-1" />
          <span className="relative z-10 text-[10px] font-medium leading-tight">
            Connect to internet to stream
          </span>
        </div>
      ) : embedError ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#12141B] p-2 text-center text-white">
          <span className="text-[11px] font-semibold text-rose-400 leading-tight">
            {embedError}
          </span>
          <a
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2 py-1 text-[10px] font-medium text-white"
          >
            <span>Open YouTube</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      ) : (
        <div
          ref={hostRef}
          style={
            shouldScaleDown
              ? {
                  width: `${VIRTUAL_STAGE_W}px`,
                  height: `${VIRTUAL_STAGE_H}px`,
                  transform: `scale(${scaleRatio})`,
                  transformOrigin: 'top left',
                }
              : undefined
          }
          className={shouldScaleDown ? 'bg-black' : 'w-full h-full bg-black'}
        />
      )}

      {/* Clean Stop Overlay Control (Full button removed per user request) */}
      <div className="absolute top-1.5 right-1.5 z-20 flex items-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
          title="Stop playback"
          aria-label="Stop playback"
          className={`${
            compact ? 'h-6 w-6' : 'h-7 w-7'
          } rounded-md bg-black/80 hover:bg-black text-white inline-flex items-center justify-center shadow transition-colors cursor-pointer`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
