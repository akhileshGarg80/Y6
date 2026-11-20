import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  BookmarkPlus,
  Check,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  ListTree,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  SkipForward,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import {getThumbnailBlob} from '../lib/offlineDb';
import {formatDuration} from '../lib/youtube';
import type {VideoBookmark, VideoChapter, VideoItem} from '../types/video';
import {CachedThumbnail} from './CachedThumbnail';

interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setPlaybackRate: (rate: number) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  getPlayerState: () => number;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: {target: YTPlayerInstance}) => void;
            onStateChange?: (event: {data: number; target: YTPlayerInstance}) => void;
            onError?: (event: {data: number}) => void;
          };
        }
      ) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface VideoPlayerStageProps {
  video: VideoItem;
  autoPlaySignal: number;
  pauseSignal?: number;
  onPlaybackStarted?: () => void;
  isOnline: boolean;
  isMini: boolean;
  theaterMode: boolean;
  zenMode: boolean;
  autoNextEnabled: boolean;
  onToggleTheater: () => void;
  onToggleZen: () => void;
  onToggleAutoNext: () => void;
  onExpandFromMini: () => void;
  onDismissMini: () => void;
  onUpdateVideo: (updated: VideoItem) => void;
  onNextVideo: () => void;
  hasNext: boolean;
}

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

type SleepMode = 'off' | 'end' | number;

export const VideoPlayerStage: React.FC<VideoPlayerStageProps> = ({
  video,
  autoPlaySignal,
  pauseSignal = 0,
  onPlaybackStarted,
  isOnline,
  isMini,
  theaterMode,
  zenMode,
  autoNextEnabled,
  onToggleTheater,
  onToggleZen,
  onToggleAutoNext,
  onExpandFromMini,
  onDismissMini,
  onUpdateVideo,
  onNextVideo,
  hasNext,
}) => {
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const playerViewportRef = useRef<HTMLDivElement | null>(null);
  const scrubberRef = useRef<HTMLDivElement | null>(null);

  const [currentTime, setCurrentTime] = useState(video.lastPositionSeconds || 0);
  const [duration, setDuration] = useState(video.durationSeconds || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(video.playbackRate || 1);
  const [loopA, setLoopA] = useState<number | null>(null);
  const [loopB, setLoopB] = useState<number | null>(null);
  const [loopActive, setLoopActive] = useState(false);

  const [ambientEnabled, setAmbientEnabled] = useState(true);
  const [ambientThumbUrl, setAmbientThumbUrl] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<{time: number; percent: number} | null>(null);

  const [sleepMode, setSleepMode] = useState<SleepMode>('off');
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const [sleepNotice, setSleepNotice] = useState<string | null>(null);

  const [bookmarkLabel, setBookmarkLabel] = useState('');
  const [notesDraft, setNotesDraft] = useState(video.notes || '');
  const [notesSaved, setNotesSaved] = useState(false);
  const [studioTab, setStudioTab] = useState<'none' | 'chapters' | 'bookmarks' | 'notes'>('none');
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  const latestVideoRef = useRef(video);
  latestVideoRef.current = video;

  const autoPlayRef = useRef(autoPlaySignal > 0);
  autoPlayRef.current = autoPlaySignal > 0;

  const autoNextRef = useRef(autoNextEnabled);
  autoNextRef.current = autoNextEnabled;

  const sleepModeRef = useRef(sleepMode);
  sleepModeRef.current = sleepMode;

  const onPlaybackStartedRef = useRef(onPlaybackStarted);
  onPlaybackStartedRef.current = onPlaybackStarted;

  useEffect(() => {
    const el = playerViewportRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setViewportWidth(rect.width);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMini]);

  // Ambient glow from cached thumbnail
  useEffect(() => {
    let active = true;
    let url: string | null = null;
    async function loadGlow() {
      const blob = await getThumbnailBlob(video.videoId);
      if (blob && active) {
        url = URL.createObjectURL(blob);
        setAmbientThumbUrl(url);
      } else if (active) {
        setAmbientThumbUrl(null);
      }
    }
    loadGlow();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [video.videoId, video.thumbCached]);

  // Lazy-fetch chapters & description if not yet loaded on this video
  useEffect(() => {
    if (!isOnline || video.chapters !== undefined) return;
    let active = true;

    async function enrichChapters() {
      try {
        const resp = await fetch(
          `/api/youtube/metadata?videoId=${encodeURIComponent(video.videoId)}`
        );
        if (!resp.ok || !active) return;
        const meta = (await resp.json()) as {
          description?: string;
          durationSeconds?: number | null;
          chapters?: VideoChapter[];
        };
        if (!active) return;
        const nextChapters = Array.isArray(meta.chapters) ? meta.chapters : [];
        onUpdateVideo({
          ...latestVideoRef.current,
          description: meta.description || latestVideoRef.current.description,
          durationSeconds: meta.durationSeconds ?? latestVideoRef.current.durationSeconds,
          chapters: nextChapters,
        });
      } catch {
        // Safe ignore
      }
    }

    enrichChapters();
    return () => {
      active = false;
    };
  }, [video.id, video.videoId, video.chapters, isOnline, onUpdateVideo]);

  useEffect(() => {
    setNotesDraft(video.notes || '');
    setCurrentTime(video.lastPositionSeconds || 0);
    setDuration(video.durationSeconds || 0);
    setPlaybackRate(video.playbackRate || 1);
    setLoopA(null);
    setLoopB(null);
    setLoopActive(false);
    setEmbedError(null);
  }, [video.id]);

  // Global single-playback lock: pause stage immediately when an inline card starts playing
  useEffect(() => {
    if (pauseSignal === 0) return;
    if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === 'function') {
      try {
        ytPlayerRef.current.pauseVideo();
      } catch {
        // Ignore
      }
    }
  }, [pauseSignal]);

  // Real Sleep Timer countdown
  useEffect(() => {
    if (typeof sleepMode !== 'number') {
      setSleepRemainingSec(null);
      return;
    }

    setSleepRemainingSec(sleepMode * 60);
    const interval = setInterval(() => {
      setSleepRemainingSec((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (ytPlayerRef.current && typeof ytPlayerRef.current.pauseVideo === 'function') {
            try {
              ytPlayerRef.current.pauseVideo();
            } catch {
              // Ignore
            }
          }
          setIsPlaying(false);
          setSleepMode('off');
          setSleepNotice('Sleep timer finished — playback paused.');
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [sleepMode]);

  // Initialize YouTube IFrame Player API
  useEffect(() => {
    if (!isOnline) {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
        ytPlayerRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const createPlayer = () => {
      if (cancelled || !ytHostRef.current || !window.YT?.Player) return;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
      }

      ytHostRef.current.innerHTML = '';
      const mountNode = document.createElement('div');
      ytHostRef.current.appendChild(mountNode);

      const shouldAutoplay = autoPlayRef.current ? 1 : 0;

      ytPlayerRef.current = new window.YT.Player(mountNode, {
        videoId: video.videoId,
        playerVars: {
          autoplay: shouldAutoplay,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          start: Math.floor(video.lastPositionSeconds || 0),
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            if (cancelled) return;
            const p = event.target;
            try {
              p.setPlaybackRate(latestVideoRef.current.playbackRate || 1);
              const dur = p.getDuration();
              if (dur > 0) setDuration(dur);
              if (autoPlayRef.current) {
                p.playVideo();
              }
            } catch {
              // Ignore
            }
          },
          onStateChange: (event) => {
            if (cancelled) return;
            const state = event.data;
            const playingNow = state === 1;
            setIsPlaying(playingNow);
            if (playingNow) {
              setSleepNotice(null);
              onPlaybackStartedRef.current?.();
            }
            if (state === 0) {
              if (sleepModeRef.current === 'end') {
                setSleepMode('off');
                setSleepNotice('Sleep timer ended playback after this video.');
              } else if (autoNextRef.current && hasNext) {
                onNextVideo();
              }
            }
          },
          onError: (event) => {
            if (cancelled) return;
            if (event.data === 101 || event.data === 150) {
              setEmbedError('Playback on external sites has been disabled by the video owner.');
            } else if (event.data === 100) {
              setEmbedError('This YouTube video is unavailable or private.');
            } else {
              setEmbedError('This YouTube video could not play in the embedded player.');
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      createPlayer();
    } else {
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existingScript) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prevCallback) prevCallback();
        createPlayer();
      };
    }

    return () => {
      cancelled = true;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
        ytPlayerRef.current = null;
      }
    };
  }, [video.videoId, isOnline, hasNext, onNextVideo]);

  useEffect(() => {
    if (autoPlaySignal === 0) return;
    if (ytPlayerRef.current && typeof ytPlayerRef.current.playVideo === 'function') {
      try {
        ytPlayerRef.current.playVideo();
      } catch {
        // Handled by onReady
      }
    }
  }, [autoPlaySignal]);

  const seekTo = useCallback((seconds: number) => {
    const clamped = Math.max(0, seconds);
    setCurrentTime(clamped);
    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.seekTo(clamped, true);
      } catch {
        // Ignore
      }
    }
  }, []);

  // Poll playback position for progress scrubber, resume persistence & A-B loop
  useEffect(() => {
    const interval = setInterval(() => {
      if (!ytPlayerRef.current || typeof ytPlayerRef.current.getCurrentTime !== 'function') {
        return;
      }
      let time = currentTime;
      let dur = duration;
      try {
        time = ytPlayerRef.current.getCurrentTime();
        const d = ytPlayerRef.current.getDuration();
        if (d > 0) dur = d;
      } catch {
        return;
      }

      if (Number.isFinite(time)) {
        setCurrentTime(time);
        if (Number.isFinite(dur) && dur > 0) setDuration(dur);

        if (loopActive && loopA !== null && loopB !== null && loopB > loopA && time >= loopB) {
          seekTo(loopA);
        }

        if (Math.abs(time - (latestVideoRef.current.lastPositionSeconds || 0)) >= 4) {
          onUpdateVideo({
            ...latestVideoRef.current,
            lastPositionSeconds: Math.floor(time),
            lastWatchedAt: Date.now(),
            durationSeconds: dur > 0 ? Math.floor(dur) : latestVideoRef.current.durationSeconds,
          });
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [loopActive, loopA, loopB, onUpdateVideo, currentTime, duration, seekTo]);

  const togglePlayPause = useCallback(() => {
    if (!ytPlayerRef.current) return;
    try {
      const state = ytPlayerRef.current.getPlayerState();
      if (state === 1) {
        ytPlayerRef.current.pauseVideo();
      } else {
        ytPlayerRef.current.playVideo();
      }
    } catch {
      // Ignore
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!ytPlayerRef.current) return;
    try {
      if (ytPlayerRef.current.isMuted()) {
        ytPlayerRef.current.unMute();
        setIsMuted(false);
      } else {
        ytPlayerRef.current.mute();
        setIsMuted(true);
      }
    } catch {
      // Ignore
    }
  }, []);

  const changeSpeed = useCallback(
    (rate: number) => {
      setPlaybackRate(rate);
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.setPlaybackRate(rate);
        } catch {
          // Ignore
        }
      }
      onUpdateVideo({...latestVideoRef.current, playbackRate: rate});
    },
    [onUpdateVideo]
  );

  const handleAddBookmark = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      const timeSec = Math.floor(currentTime);
      const label = bookmarkLabel.trim() || `Timestamp ${formatDuration(timeSec)}`;
      const newBm: VideoBookmark = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timeSeconds: timeSec,
        label,
        createdAt: Date.now(),
      };
      const updatedBookmarks = [...video.bookmarks, newBm].sort(
        (a, b) => a.timeSeconds - b.timeSeconds
      );
      onUpdateVideo({...video, bookmarks: updatedBookmarks});
      setBookmarkLabel('');
    },
    [currentTime, bookmarkLabel, video, onUpdateVideo]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key.toLowerCase() === 'j') {
        e.preventDefault();
        seekTo(currentTime - 10);
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        seekTo(currentTime + 10);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(currentTime - 5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(currentTime + 5);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        onToggleTheater();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onToggleZen();
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setStudioTab('bookmarks');
        handleAddBookmark();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    togglePlayPause,
    seekTo,
    currentTime,
    toggleMute,
    onToggleTheater,
    onToggleZen,
    handleAddBookmark,
  ]);

  function handleSaveNotes() {
    onUpdateVideo({...video, notes: notesDraft});
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 1800);
  }

  function handleExportMarkdown() {
    const chaptersSection =
      (video.chapters?.length ?? 0) > 0
        ? `\n## Chapters\n${video.chapters!.map((c) => `- **${formatDuration(c.timeSeconds)}** — ${c.label}`).join('\n')}\n`
        : '';

    const bookmarksSection =
      video.bookmarks.length > 0
        ? `\n## Pinned Bookmarks\n${video.bookmarks.map((b) => `- **${formatDuration(b.timeSeconds)}** — ${b.label}`).join('\n')}\n`
        : '';

    const notesSection = notesDraft.trim() ? `\n## Notes\n${notesDraft.trim()}\n` : '';

    const md = `# ${video.title}\n\n- **Channel:** ${video.authorName}\n- **Collection:** ${video.collection}\n- **YouTube Link:** ${video.originalUrl}\n${chaptersSection}${bookmarksSection}${notesSection}`;
    const blob = new Blob([md], {type: 'text/markdown;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = video.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48);
    a.download = `${safeName || video.videoId}-notes.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleScrubClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!scrubberRef.current || duration <= 0) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  }

  function handleScrubMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!scrubberRef.current || duration <= 0) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverTime({time: ratio * duration, percent: ratio * 100});
  }

  const chapters = video.chapters || [];
  const activeChapter = useMemo(() => {
    if (chapters.length === 0) return null;
    let found: VideoChapter | null = null;
    for (const ch of chapters) {
      if (ch.timeSeconds <= currentTime + 1) found = ch;
      else break;
    }
    return found;
  }, [chapters, currentTime]);

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const loopStartPercent =
    duration > 0 && loopA !== null ? Math.min(100, (loopA / duration) * 100) : null;
  const loopEndPercent =
    duration > 0 && loopB !== null ? Math.min(100, (loopB / duration) * 100) : null;

  return (
    <div
      className={
        isMini
          ? 'rounded-2xl border border-slate-200 dark:border-[#242A38] bg-white/95 dark:bg-[#13161D]/95 backdrop-blur-md shadow-2xl overflow-hidden'
          : 'relative space-y-4'
      }
    >
      {/* Ambient Cinema Glow Backdrop behind stage (toggled cleanly by user) */}
      {!isMini && ambientEnabled && ambientThumbUrl && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-8 -top-6 h-[62%] rounded-full opacity-25 dark:opacity-35 blur-3xl saturate-150 transition-opacity duration-700"
          style={{
            backgroundImage: `url(${ambientThumbUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}

      {/* Persistent Media Viewport — moves seamlessly between Full Stage and Mini-Player */}
      <div className={`relative z-10 ${isMini ? 'flex sm:block items-center gap-2.5 p-2 sm:p-0' : ''}`}>
        <div
          ref={playerViewportRef}
          className={
            isMini
              ? 'relative w-24 sm:w-full aspect-video rounded-lg sm:rounded-none overflow-hidden bg-black shrink-0'
              : 'relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-slate-200 dark:border-[#1E2430] shadow-2xl'
          }
        >
          {isOnline ? (
            embedError ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#10131A] p-6 text-center text-white">
                <p className="text-sm font-semibold text-rose-400 max-w-md">{embedError}</p>
                {video.originalUrl && (
                  <a
                    href={video.originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 min-h-[40px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white inline-flex items-center gap-2"
                  >
                    <span>Watch Directly on YouTube</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ) : (
              <div
                ref={ytHostRef}
                style={
                  isMini && viewportWidth > 0 && viewportWidth < 400
                    ? {
                        width: '480px',
                        height: '270px',
                        transform: `scale(${viewportWidth / 480})`,
                        transformOrigin: 'top left',
                      }
                    : undefined
                }
                className={
                  isMini && viewportWidth > 0 && viewportWidth < 400
                    ? 'bg-black'
                    : 'w-full h-full'
                }
              />
            )
          ) : (
            <div className="relative w-full h-full flex items-center justify-center">
              <CachedThumbnail
                videoId={video.videoId}
                alt={video.title}
                isOnline={false}
                className="absolute inset-0 w-full h-full opacity-35 blur-[1px]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/75 to-black/60" />
              {!isMini && (
                <div className="relative z-10 max-w-md px-6 text-center text-white">
                  <div className="mx-auto w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mb-3">
                    <WifiOff className="w-5 h-5 text-amber-400" />
                  </div>
                  <h3 className="text-base font-semibold tracking-tight">No Internet Connection</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                    Thumbnails, chapters, pinned timestamps, and notes are cached locally, but streaming YouTube video requires an active internet connection.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mini-Player Compact Bar */}
        {isMini && (
          <div className="min-w-0 flex-1 sm:px-3 sm:py-2.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onExpandFromMini}
              className="min-w-0 flex-1 text-left cursor-pointer group"
            >
              <div className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-rose-500 transition-colors">
                {video.title}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono tabular-nums">
                {video.authorName} · {formatDuration(currentTime)}
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={togglePlayPause}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>

              {hasNext && (
                <button
                  type="button"
                  onClick={onNextVideo}
                  aria-label="Next track"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1C212C] cursor-pointer"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={onExpandFromMini}
                title="Expand to Full Player"
                aria-label="Expand to Full Player"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1C212C] cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={onDismissMini}
                title="Hide Mini-Player"
                aria-label="Hide Mini-Player"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Full Stage Precision Timeline, Studio Controls & Metadata */}
      {!isMini && (
        <div className="relative z-10 space-y-4">
          {sleepNotice && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 flex items-center justify-between gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 shrink-0" />
                <span>{sleepNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setSleepNotice(null)}
                aria-label="Dismiss sleep notice"
                className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Precision Interactive Scrubber with Chapter Ticks, Pinned Bookmarks & A-B Loop Highlight */}
          <div className="rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white/95 dark:bg-[#13161D]/95 backdrop-blur-sm px-4 py-3 space-y-3">
            <div className="space-y-1.5">
              <div
                ref={scrubberRef}
                onClick={handleScrubClick}
                onMouseMove={handleScrubMove}
                onMouseLeave={() => setHoverTime(null)}
                role="slider"
                aria-label="Seek timeline"
                aria-valuemin={0}
                aria-valuemax={Math.floor(duration)}
                aria-valuenow={Math.floor(currentTime)}
                tabIndex={0}
                className="relative h-5 flex items-center cursor-pointer group select-none"
              >
                {hoverTime && (
                  <div
                    style={{left: `${Math.min(96, Math.max(4, hoverTime.percent))}%`}}
                    className="pointer-events-none -translate-x-1/2 -top-7 absolute rounded bg-slate-900 dark:bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white dark:text-slate-900 tabular-nums shadow"
                  >
                    {formatDuration(hoverTime.time)}
                  </div>
                )}

                <div className="relative w-full h-1.5 group-hover:h-2 transition-all rounded-full bg-slate-200 dark:bg-[#242A38] overflow-visible">
                  {/* A-B Loop Segment Highlight */}
                  {loopStartPercent !== null &&
                    loopEndPercent !== null &&
                    loopEndPercent > loopStartPercent && (
                      <div
                        style={{
                          left: `${loopStartPercent}%`,
                          width: `${loopEndPercent - loopStartPercent}%`,
                        }}
                        className="absolute inset-y-0 bg-amber-500/45 rounded-full"
                      />
                    )}

                  {/* Active Playback Fill */}
                  <div
                    style={{width: `${progressPercent}%`}}
                    className="h-full rounded-full bg-rose-600 transition-[width] duration-150"
                  />

                  {/* Playhead Thumb */}
                  <div
                    style={{left: `${progressPercent}%`}}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-rose-600 ring-2 ring-white dark:ring-[#13161D] shadow opacity-0 group-hover:opacity-100 transition-opacity"
                  />

                  {/* Chapter Ticks */}
                  {duration > 0 &&
                    chapters.map((ch, idx) => {
                      const pct = Math.min(99, Math.max(1, (ch.timeSeconds / duration) * 100));
                      return (
                        <button
                          key={`${ch.timeSeconds}-${idx}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            seekTo(ch.timeSeconds);
                          }}
                          title={`${formatDuration(ch.timeSeconds)} · ${ch.label}`}
                          style={{left: `${pct}%`}}
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-3 rounded-full bg-slate-400 dark:bg-slate-200/75 hover:bg-white hover:scale-125 transition-transform cursor-pointer"
                        />
                      );
                    })}

                  {/* Pinned User Bookmark Markers */}
                  {duration > 0 &&
                    video.bookmarks.map((bm) => {
                      const pct = Math.min(99, Math.max(1, (bm.timeSeconds / duration) * 100));
                      return (
                        <button
                          key={bm.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            seekTo(bm.timeSeconds);
                          }}
                          title={`Bookmark ${formatDuration(bm.timeSeconds)} · ${bm.label}`}
                          style={{left: `${pct}%`}}
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-[#13161D] hover:scale-125 transition-transform cursor-pointer"
                        />
                      );
                    })}
                </div>
              </div>

              {activeChapter && (
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <button
                    type="button"
                    onClick={() => setStudioTab('chapters')}
                    className="inline-flex items-center gap-1.5 hover:text-rose-500 transition-colors cursor-pointer truncate"
                  >
                    <ListTree className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                      Chapter: {activeChapter.label}
                    </span>
                  </button>
                  <span className="font-mono tabular-nums shrink-0">
                    {chapters.length} chapters
                  </span>
                </div>
              )}
            </div>

            {/* Control Deck */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-slate-100 dark:border-[#1E2430]">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={togglePlayPause}
                  disabled={!isOnline}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="min-h-[38px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white inline-flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer"
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isPlaying ? 'Pause' : 'Play'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => seekTo(currentTime - 10)}
                  disabled={!isOnline}
                  title="Rewind 10s (J)"
                  className="min-h-[38px] px-2.5 rounded-lg border border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] disabled:opacity-40 inline-flex items-center gap-1 text-xs font-mono cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>10s</span>
                </button>

                <button
                  type="button"
                  onClick={() => seekTo(currentTime + 10)}
                  disabled={!isOnline}
                  title="Forward 10s (L)"
                  className="min-h-[38px] px-2.5 rounded-lg border border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] disabled:opacity-40 inline-flex items-center gap-1 text-xs font-mono cursor-pointer"
                >
                  <span>10s</span>
                  <RotateCw className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={toggleMute}
                  disabled={!isOnline}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] disabled:opacity-40 cursor-pointer"
                >
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>

                {hasNext && (
                  <button
                    type="button"
                    onClick={onNextVideo}
                    className="min-h-[38px] px-2.5 rounded-lg border border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>Next</span>
                  </button>
                )}

                <div className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400 px-1.5">
                  {formatDuration(currentTime)} / {formatDuration(duration)}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label="Playback speed"
                  value={playbackRate}
                  onChange={(e) => changeSpeed(Number(e.target.value))}
                  className="min-h-[38px] rounded-lg border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] px-2 font-mono text-xs text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  {SPEED_OPTIONS.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}x
                    </option>
                  ))}
                </select>

                {/* A-B Loop Studio */}
                <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-[#242A38] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setLoopA(Math.floor(currentTime))}
                    title="Set Loop Start (A)"
                    className={`min-h-[36px] px-2 font-mono text-xs transition-colors cursor-pointer ${
                      loopA !== null
                        ? 'bg-rose-600/15 text-rose-600 dark:text-rose-400 font-semibold'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                    }`}
                  >
                    A{loopA !== null ? `:${formatDuration(loopA)}` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const b = Math.floor(currentTime);
                      setLoopB(b);
                      if (loopA !== null && b > loopA) setLoopActive(true);
                    }}
                    title="Set Loop End (B)"
                    className={`min-h-[36px] px-2 font-mono text-xs border-l border-slate-200 dark:border-[#242A38] transition-colors cursor-pointer ${
                      loopB !== null
                        ? 'bg-rose-600/15 text-rose-600 dark:text-rose-400 font-semibold'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                    }`}
                  >
                    B{loopB !== null ? `:${formatDuration(loopB)}` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (loopActive) {
                        setLoopActive(false);
                        setLoopA(null);
                        setLoopB(null);
                      } else if (loopA !== null && loopB !== null && loopB > loopA) {
                        setLoopActive(true);
                      }
                    }}
                    disabled={loopA === null || loopB === null}
                    title="Toggle A-B Loop"
                    className={`min-h-[36px] px-2 border-l border-slate-200 dark:border-[#242A38] inline-flex items-center gap-1 text-xs disabled:opacity-40 cursor-pointer ${
                      loopActive
                        ? 'bg-rose-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                    }`}
                  >
                    <Repeat className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Sleep Timer */}
                <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] px-2 min-h-[38px]">
                  <Clock className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
                  <select
                    aria-label="Sleep timer"
                    value={String(sleepMode)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSleepNotice(null);
                      if (val === 'off' || val === 'end') setSleepMode(val);
                      else setSleepMode(Number(val));
                    }}
                    className="bg-transparent text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
                  >
                    <option value="off">Sleep: Off</option>
                    <option value="15">Sleep: 15m</option>
                    <option value="30">Sleep: 30m</option>
                    <option value="45">Sleep: 45m</option>
                    <option value="60">Sleep: 60m</option>
                    <option value="end">End of Video</option>
                  </select>
                  {sleepRemainingSec !== null && (
                    <span className="ml-1.5 font-mono text-[11px] font-semibold text-amber-500 tabular-nums">
                      {formatDuration(sleepRemainingSec)}
                    </span>
                  )}
                </div>

                {/* Auto-Next Toggle */}
                <button
                  type="button"
                  onClick={onToggleAutoNext}
                  title="Auto-play next video in queue"
                  className={`min-h-[38px] px-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    autoNextEnabled
                      ? 'border-rose-500/40 bg-rose-600/10 text-rose-600 dark:text-rose-400'
                      : 'border-slate-200 dark:border-[#242A38] text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                  }`}
                >
                  Auto-Next {autoNextEnabled ? 'On' : 'Off'}
                </button>

                {/* Ambient Glow Toggle */}
                <button
                  type="button"
                  onClick={() => setAmbientEnabled((v) => !v)}
                  title="Toggle Ambient Cinema Glow"
                  className={`min-h-[38px] px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer ${
                    ambientEnabled
                      ? 'border-rose-500/40 bg-rose-600/10 text-rose-600 dark:text-rose-400'
                      : 'border-slate-200 dark:border-[#242A38] text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Ambient</span>
                </button>

                {/* Zen Focus Mode */}
                <button
                  type="button"
                  onClick={onToggleZen}
                  title="Zen Focus Mode (F)"
                  className={`min-h-[38px] px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer ${
                    zenMode
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Zen</span>
                </button>

                {/* Theater Mode */}
                <button
                  type="button"
                  onClick={onToggleTheater}
                  title="Theater Mode (T)"
                  className="hidden lg:inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] cursor-pointer"
                >
                  {theaterMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Video Title & Studio Tools Bar */}
          <div className="px-1 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-snug">
                {video.title}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {video.authorName}
                </span>
                <span aria-hidden="true">·</span>
                <span>{video.collection}</span>
                {video.thumbCached && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Thumb Cached
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {chapters.length > 0 && (
                <button
                  type="button"
                  onClick={() => setStudioTab((t) => (t === 'chapters' ? 'none' : 'chapters'))}
                  className={`min-h-[38px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    studioTab === 'chapters'
                      ? 'border-rose-600 bg-rose-600/10 text-rose-600 dark:text-rose-400'
                      : 'border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                  }`}
                >
                  <ListTree className="w-3.5 h-3.5 text-rose-500" />
                  <span>Chapters ({chapters.length})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setStudioTab((t) => (t === 'bookmarks' ? 'none' : 'bookmarks'))}
                className={`min-h-[38px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  studioTab === 'bookmarks'
                    ? 'border-rose-600 bg-rose-600/10 text-rose-600 dark:text-rose-400'
                    : 'border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                }`}
              >
                <BookmarkPlus className="w-3.5 h-3.5 text-rose-500" />
                <span>Timestamps ({video.bookmarks.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setStudioTab((t) => (t === 'notes' ? 'none' : 'notes'))}
                className={`min-h-[38px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  studioTab === 'notes'
                    ? 'border-rose-600 bg-rose-600/10 text-rose-600 dark:text-rose-400'
                    : 'border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-rose-500" />
                <span>Notes</span>
              </button>

              {video.originalUrl && (
                <a
                  href={video.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[38px] px-3 rounded-lg border border-slate-200 dark:border-[#242A38] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1C212C] inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <span>YouTube</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>

          {/* Chapters Drawer */}
          {studioTab === 'chapters' && chapters.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Video Chapters
                </h2>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  Click any chapter to jump
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-60 overflow-y-auto pr-1">
                {chapters.map((ch, idx) => {
                  const isCurrent = activeChapter?.timeSeconds === ch.timeSeconds;
                  return (
                    <button
                      key={`${ch.timeSeconds}-${idx}`}
                      type="button"
                      onClick={() => seekTo(ch.timeSeconds)}
                      className={`px-3 py-2 rounded-xl border text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
                        isCurrent
                          ? 'border-rose-500/60 bg-rose-600/10 text-rose-600 dark:text-rose-400'
                          : 'border-slate-100 dark:border-[#1E2430] hover:bg-slate-50 dark:hover:bg-[#171B24] text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span className="font-mono text-xs font-semibold tabular-nums shrink-0 text-rose-500">
                        {formatDuration(ch.timeSeconds)}
                      </span>
                      <span className="text-xs truncate">{ch.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timestamp Bookmarks Drawer */}
          {studioTab === 'bookmarks' && (
            <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Timestamp Bookmarks (Press B)
                </h2>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {video.bookmarks.length} pinned
                </span>
              </div>

              <form onSubmit={handleAddBookmark} className="flex items-center gap-2">
                <input
                  type="text"
                  value={bookmarkLabel}
                  onChange={(e) => setBookmarkLabel(e.target.value)}
                  placeholder={`Pin note at ${formatDuration(currentTime)}...`}
                  className="flex-1 min-h-[40px] rounded-lg border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] px-3 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-600/50"
                />
                <button
                  type="submit"
                  className="min-h-[40px] px-3.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>Pin {formatDuration(currentTime)}</span>
                </button>
              </form>

              {video.bookmarks.length > 0 && (
                <div className="divide-y divide-slate-100 dark:divide-[#1E2430] max-h-48 overflow-y-auto">
                  {video.bookmarks.map((bm) => (
                    <div key={bm.id} className="py-2 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => seekTo(bm.timeSeconds)}
                        className="flex items-center gap-2.5 text-left min-w-0 flex-1 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                      >
                        <span className="font-mono text-xs font-semibold text-rose-600 dark:text-rose-400 tabular-nums shrink-0">
                          {formatDuration(bm.timeSeconds)}
                        </span>
                        <span className="text-xs text-slate-700 dark:text-slate-300 truncate">
                          {bm.label}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateVideo({
                            ...video,
                            bookmarks: video.bookmarks.filter((b) => b.id !== bm.id),
                          })
                        }
                        aria-label="Remove bookmark"
                        className="p-1.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Markdown Notes + Export Drawer */}
          {studioTab === 'notes' && (
            <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="video-notes-area"
                  className="text-sm font-semibold text-slate-900 dark:text-white"
                >
                  Watch Notes &amp; Study Sheet
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleExportMarkdown}
                    className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export .md Notes</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveNotes}
                    className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    {notesSaved ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">Saved</span>
                      </>
                    ) : (
                      <span>Save Notes</span>
                    )}
                  </button>
                </div>
              </div>
              <textarea
                id="video-notes-area"
                rows={4}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={handleSaveNotes}
                placeholder="Write key takeaways, lyrics, code snippets, or timestamps here..."
                className="w-full rounded-xl border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] px-3 py-2.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-600/50"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
