import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Copy,
  Headphones,
  Heart,
  Loader2,
  Maximize2,
  Plus,
  RefreshCw,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import type {ReelItem, SuggestedVideoInput, VideoItem} from '../types/video';

interface ReelsFeedViewProps {
  videos: VideoItem[];
  existingVideoIds: Set<string>;
  isOnline: boolean;
  onReelPlaybackStarted: () => void;
  onSaveReel: (suggested: SuggestedVideoInput) => void;
  onSaveAndLikeReel: (suggested: SuggestedVideoInput) => void;
  onPlayReelInMusic: (suggested: SuggestedVideoInput) => void;
  onOpenReelInPlayer: (suggested: SuggestedVideoInput) => void;
  onToggleLikeSaved: (video: VideoItem) => void;
}

const REEL_TOPICS = [
  {id: 'all', label: 'For You'},
  {id: 'music', label: 'Music'},
  {id: 'comedy', label: 'Comedy'},
  {id: 'tech', label: 'Tech'},
  {id: 'motivation', label: 'Motivation'},
  {id: 'gaming', label: 'Gaming'},
];

export const ReelsFeedView: React.FC<ReelsFeedViewProps> = ({
  videos,
  existingVideoIds,
  isOnline,
  onReelPlaybackStarted,
  onSaveReel,
  onSaveAndLikeReel,
  onPlayReelInMusic,
  onOpenReelInPlayer,
  onToggleLikeSaved,
}) => {
  const [topic, setTopic] = useState('all');
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [nextPage, setNextPage] = useState(0);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const fetchingRef = useRef(false);
  const onPlaybackRef = useRef(onReelPlaybackStarted);
  onPlaybackRef.current = onReelPlaybackStarted;

  const savedByYtId = useMemo(() => {
    const map = new Map<string, VideoItem>();
    for (const v of videos) {
      map.set(v.videoId, v);
    }
    return map;
  }, [videos]);

  const fetchBatch = useCallback(
    async (targetTopic: string, pageNum: number, reset: boolean) => {
      if (!isOnline || fetchingRef.current) return;
      fetchingRef.current = true;
      if (reset) {
        setLoadingInitial(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        let attempts = 0;
        let currentPage = pageNum;
        let added: ReelItem[] = [];

        while (attempts < 2 && added.length === 0) {
          const resp = await fetch(
            `/api/youtube/reels?topic=${encodeURIComponent(targetTopic)}&page=${currentPage}`
          );
          const data = (await resp.json()) as {
            reels?: ReelItem[];
            nextPage?: number;
            error?: string;
          };
          if (!resp.ok) {
            throw new Error(data.error || 'Could not load Reels');
          }

          const batch = Array.isArray(data.reels) ? data.reels : [];
          const fresh = batch.filter((item) => !seenIdsRef.current.has(item.videoId));
          for (const item of fresh) {
            seenIdsRef.current.add(item.videoId);
          }
          added = fresh;
          currentPage = typeof data.nextPage === 'number' ? data.nextPage : currentPage + 1;
          attempts++;
        }

        if (added.length > 0) {
          setReels((prev) => (reset ? added : [...prev, ...added]));
        }
        setNextPage(currentPage);
      } catch (err) {
        if (reset) {
          setError(err instanceof Error ? err.message : 'Failed to load Reels');
        }
      } finally {
        fetchingRef.current = false;
        setLoadingInitial(false);
        setLoadingMore(false);
      }
    },
    [isOnline]
  );

  // Load initial reels when topic changes or back online
  useEffect(() => {
    seenIdsRef.current = new Set();
    setReels([]);
    setActiveIndex(0);
    setNextPage(0);
    if (containerRef.current) {
      containerRef.current.scrollTo({top: 0});
    }
    if (isOnline) {
      fetchBatch(topic, 0, true);
    }
  }, [topic, isOnline, fetchBatch]);

  // Pause global Stage / Music players when user enters Reels & scrolls to a reel
  useEffect(() => {
    if (reels.length > 0 && isOnline) {
      onPlaybackRef.current();
    }
  }, [activeIndex, reels.length, isOnline]);

  // Observe whichever reel card is centered in the snap container
  useEffect(() => {
    const root = containerRef.current;
    if (!root || reels.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const idxAttr = entry.target.getAttribute('data-reel-index');
            if (idxAttr !== null) {
              const parsed = Number(idxAttr);
              if (Number.isFinite(parsed)) {
                setActiveIndex(parsed);
              }
            }
          }
        }
      },
      {root, threshold: 0.6}
    );

    for (let i = 0; i < reels.length; i++) {
      const el = slideRefs.current[i];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [reels.length]);

  // Endless auto-pagination: prefetch next batch 5 reels before reaching end
  useEffect(() => {
    if (isOnline && reels.length > 0 && activeIndex >= reels.length - 5 && !loadingMore) {
      fetchBatch(topic, nextPage, false);
    }
  }, [activeIndex, reels.length, topic, nextPage, loadingMore, isOnline, fetchBatch]);

  const scrollToReel = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(reels.length - 1, index));
      const el = slideRefs.current[clamped];
      if (el) {
        el.scrollIntoView({behavior: 'smooth', block: 'start'});
      }
    },
    [reels.length]
  );

  // Desktop keyboard Up / Down navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'ArrowDown' || e.key.toLowerCase() === 'j') {
        e.preventDefault();
        scrollToReel(activeIndex + 1);
      } else if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        scrollToReel(activeIndex - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, scrollToReel]);

  async function handleCopyShortUrl(reel: ReelItem) {
    try {
      await navigator.clipboard.writeText(reel.shortsUrl);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = reel.shortsUrl;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedId(reel.videoId);
    setTimeout(() => setCopiedId((prev) => (prev === reel.videoId ? null : prev)), 2000);
  }

  return (
    <div className="relative -mx-2.5 sm:mx-0 -my-4 sm:-my-1 rounded-none sm:rounded-3xl overflow-hidden bg-black border-0 sm:border sm:border-slate-800 shadow-2xl h-[calc(100dvh-56px-56px)] md:h-[calc(100dvh-92px)]">
      {/* Top Floating Topic Bar */}
      <div className="absolute top-0 inset-x-0 z-20 p-3 bg-gradient-to-b from-black/85 via-black/45 to-transparent pointer-events-none">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pointer-events-auto">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-rose-600 text-white text-xs font-bold shrink-0 shadow">
            <Clapperboard className="w-3.5 h-3.5" />
            <span>Reels</span>
          </div>
          {REEL_TOPICS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTopic(t.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                topic === t.id
                  ? 'bg-white text-black shadow'
                  : 'bg-white/15 hover:bg-white/25 text-white backdrop-blur-md'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Offline State */}
      {!isOnline ? (
        <div className="h-full flex flex-col items-center justify-center p-6 text-center text-white space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <WifiOff className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold">Internet Required for Reels</h2>
          <p className="text-xs text-slate-400 max-w-xs">
            Connect to the internet to endlessly scroll and stream vertical Reels.
          </p>
        </div>
      ) : loadingInitial && reels.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-white gap-3">
          <Loader2 className="w-7 h-7 animate-spin text-rose-500" />
          <span className="text-xs font-medium text-slate-300">Loading endless Reels...</span>
        </div>
      ) : error && reels.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center p-6 text-center text-white space-y-3">
          <p className="text-sm text-rose-400">{error}</p>
          <button
            type="button"
            onClick={() => fetchBatch(topic, 0, true)}
            className="min-h-[40px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : (
        /* Endless Vertical Snap-Scroll Feed */
        <div
          ref={containerRef}
          className="h-full w-full overflow-y-scroll snap-y snap-mandatory scroll-smooth no-scrollbar"
        >
          {reels.map((reel, idx) => {
            const isActive = idx === activeIndex;
            const savedItem = savedByYtId.get(reel.videoId);
            const alreadySaved = existingVideoIds.has(reel.videoId);
            const isCopied = copiedId === reel.videoId;

            const payload: SuggestedVideoInput = {
              videoId: reel.videoId,
              title: reel.title,
              authorName: reel.authorName,
            };

            const originParam =
              typeof window !== 'undefined'
                ? `&origin=${encodeURIComponent(window.location.origin)}`
                : '';

            return (
              <div
                key={`${reel.videoId}-${idx}`}
                ref={(el) => {
                  slideRefs.current[idx] = el;
                }}
                data-reel-index={idx}
                className="relative h-full w-full snap-start snap-always flex items-center justify-center bg-black overflow-hidden"
              >
                {/* 9:16 Vertical Stage on Desktop, Fullscreen Fill on Mobile */}
                <div className="relative w-full h-full sm:w-auto sm:h-[calc(100%-24px)] sm:aspect-[9/16] sm:rounded-2xl overflow-hidden bg-black sm:border sm:border-white/10 shadow-2xl">
                  {isActive ? (
                    <iframe
                      key={`${reel.videoId}-${muted ? 'm' : 'u'}`}
                      src={`https://www.youtube.com/embed/${reel.videoId}?autoplay=1&loop=1&playlist=${reel.videoId}&playsinline=1&rel=0&modestbranding=1&controls=1&mute=${
                        muted ? 1 : 0
                      }${originParam}`}
                      title={reel.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      className="w-full h-full border-0"
                    />
                  ) : (
                    <img
                      src={reel.thumbnailUrl}
                      alt={reel.title}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (!img.dataset.fallbackApplied) {
                          img.dataset.fallbackApplied = '1';
                          img.src = `https://i.ytimg.com/vi/${reel.videoId}/hqdefault.jpg`;
                        }
                      }}
                      className="w-full h-full object-cover"
                    />
                  )}

                  {/* Bottom Title Scrim (pointer-events-none so player controls stay tappable) */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-4 pr-16 flex flex-col justify-end">
                    <div className="text-xs font-semibold text-white line-clamp-2 leading-snug drop-shadow">
                      {reel.title}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-white/75 font-mono">
                      <span>{reel.authorName}</span>
                      {reel.viewText && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{reel.viewText}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right-Side Vertical Reels Action Rail */}
                  <div className="absolute right-2.5 bottom-16 z-10 flex flex-col items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (savedItem) {
                          onToggleLikeSaved(savedItem);
                        } else {
                          onSaveAndLikeReel(payload);
                        }
                      }}
                      aria-label={savedItem?.liked ? 'Liked reel' : 'Like & save reel'}
                      className="flex flex-col items-center gap-1 cursor-pointer group"
                    >
                      <span
                        className={`w-11 h-11 rounded-full backdrop-blur-md border flex items-center justify-center transition-transform active:scale-90 ${
                          savedItem?.liked
                            ? 'bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-600/35'
                            : 'bg-black/55 border-white/20 text-white hover:bg-black/80'
                        }`}
                      >
                        <Heart className={`w-5 h-5 ${savedItem?.liked ? 'fill-current' : ''}`} />
                      </span>
                      <span className="text-[10px] font-semibold text-white drop-shadow">
                        {savedItem?.liked ? 'Liked' : 'Like'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSaveReel(payload)}
                      aria-label={alreadySaved ? 'Saved in library' : 'Save reel'}
                      className="flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span
                        className={`w-11 h-11 rounded-full backdrop-blur-md border flex items-center justify-center transition-transform active:scale-90 ${
                          alreadySaved
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'bg-black/55 border-white/20 text-white hover:bg-black/80'
                        }`}
                      >
                        {alreadySaved ? (
                          <Check className="w-5 h-5" />
                        ) : (
                          <Plus className="w-5 h-5" />
                        )}
                      </span>
                      <span className="text-[10px] font-semibold text-white drop-shadow">
                        {alreadySaved ? 'Saved' : 'Save'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onPlayReelInMusic(payload)}
                      aria-label="Listen in Music mode"
                      className="flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span className="w-11 h-11 rounded-full bg-black/55 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-transform active:scale-90">
                        <Headphones className="w-5 h-5" />
                      </span>
                      <span className="text-[10px] font-semibold text-white drop-shadow">
                        Audio
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenReelInPlayer(payload)}
                      aria-label="Open in full player"
                      className="flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span className="w-11 h-11 rounded-full bg-black/55 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition-transform active:scale-90">
                        <Maximize2 className="w-4 h-4" />
                      </span>
                      <span className="text-[10px] font-semibold text-white drop-shadow">
                        Player
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMuted((m) => !m)}
                      aria-label={muted ? 'Unmute reel' : 'Mute reel'}
                      className="flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span className="w-10 h-10 rounded-full bg-black/55 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white flex items-center justify-center">
                        {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyShortUrl(reel)}
                      aria-label="Copy Shorts URL"
                      className="flex flex-col items-center gap-1 cursor-pointer"
                    >
                      <span className="w-10 h-10 rounded-full bg-black/55 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white flex items-center justify-center">
                        {isCopied ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Desktop Side Scroll Arrows */}
                <div className="hidden md:flex flex-col gap-2 absolute right-6 top-1/2 -translate-y-1/2 z-20">
                  <button
                    type="button"
                    onClick={() => scrollToReel(idx - 1)}
                    disabled={idx === 0}
                    aria-label="Previous reel"
                    className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 backdrop-blur-md border border-white/15 text-white flex items-center justify-center cursor-pointer"
                  >
                    <ChevronUp className="w-5 h-5" />
                  </button>
                  <div className="text-center font-mono text-[10px] text-white/60 tabular-nums">
                    {idx + 1}
                  </div>
                  <button
                    type="button"
                    onClick={() => scrollToReel(idx + 1)}
                    aria-label="Next reel"
                    className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/15 text-white flex items-center justify-center cursor-pointer"
                  >
                    <ChevronDown className="w-5 h-5" />
                  </button>
                </div>
              </div>
            );
          })}

          {loadingMore && (
            <div className="h-24 flex items-center justify-center gap-2 text-xs text-white/70 bg-black">
              <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
              <span>Loading more Reels...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
