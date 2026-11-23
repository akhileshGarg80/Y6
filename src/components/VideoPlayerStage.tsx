import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  BookmarkPlus,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Clock,
  Compass,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Heart,
  Link2,
  ListTree,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
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
import {updateMediaSession} from '../lib/mediaSession';
import {getThumbnailBlob} from '../lib/offlineDb';
import {extractVideoIdFromUrl, formatDuration} from '../lib/youtube';
import type {
  RelatedVideoItem,
  SuggestedVideoInput,
  VideoBookmark,
  VideoChapter,
  VideoItem,
} from '../types/video';
import {CachedThumbnail} from './CachedThumbnail';

interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  loadVideoById?: (
    videoIdOrOptions: string | {videoId: string; startSeconds?: number}
  ) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getVideoData?: () => {video_id?: string; title?: string; author?: string};
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
  onCaptureSuggestedVideo?: (suggested: SuggestedVideoInput, playInStage?: boolean) => void;
  onSaveAllSuggested?: (items: SuggestedVideoInput[]) => Promise<number>;
  sharedRelatedVideos?: RelatedVideoItem[];
  sharedRelatedLoading?: boolean;
  sharedRelatedForVideoId?: string | null;
  existingVideoIds?: Set<string>;
  autoSaveNotice?: string | null;
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
  onCaptureSuggestedVideo,
  onSaveAllSuggested,
  sharedRelatedVideos,
  sharedRelatedLoading,
  sharedRelatedForVideoId,
  existingVideoIds,
  autoSaveNotice,
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
  const playerReadyRef = useRef(false);
  const iframeLoadedVideoIdRef = useRef<string | null>(null);
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

  const [localRelatedVideos, setLocalRelatedVideos] = useState<RelatedVideoItem[]>([]);
  const [localRelatedLoading, setLocalRelatedLoading] = useState(false);
  const usingSharedRelated =
    sharedRelatedForVideoId === video.videoId && sharedRelatedVideos !== undefined;
  const relatedVideos = usingSharedRelated ? sharedRelatedVideos : localRelatedVideos;
  const relatedLoading = usingSharedRelated
    ? Boolean(sharedRelatedLoading)
    : localRelatedLoading;
  const [isEnded, setIsEnded] = useState(false);
  const [showAllUrlsDrawer, setShowAllUrlsDrawer] = useState(false);
  const [showAllRelatedGrid, setShowAllRelatedGrid] = useState(false);
  const [copiedAllUrls, setCopiedAllUrls] = useState(false);
  const [copiedSingleId, setCopiedSingleId] = useState<string | null>(null);
  const [savingAllRelated, setSavingAllRelated] = useState(false);
  const [pasteBoxOpen, setPasteBoxOpen] = useState(false);
  const [pasteUrlValue, setPasteUrlValue] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

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

  const onCaptureSuggestedRef = useRef(onCaptureSuggestedVideo);
  onCaptureSuggestedRef.current = onCaptureSuggestedVideo;

  const hasNextRef = useRef(hasNext);
  hasNextRef.current = hasNext;

  const onNextVideoRef = useRef(onNextVideo);
  onNextVideoRef.current = onNextVideo;

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
    setIsEnded(false);
    setShowAllRelatedGrid(false);
    setCopiedAllUrls(false);
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

  // Fetch real YouTube Suggested Videos if not already lifted/provided by App.tsx
  useEffect(() => {
    if (isMini || !isOnline || usingSharedRelated) {
      if (!usingSharedRelated) {
        setLocalRelatedVideos([]);
      }
      return;
    }

    let active = true;
    setLocalRelatedLoading(true);
    fetch(`/api/youtube/related?videoId=${encodeURIComponent(video.videoId)}`)
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data: {related?: RelatedVideoItem[]} | null) => {
        if (!active) return;
        setLocalRelatedVideos(Array.isArray(data?.related) ? data.related : []);
      })
      .catch(() => {
        if (active) setLocalRelatedVideos([]);
      })
      .finally(() => {
        if (active) setLocalRelatedLoading(false);
      });

    return () => {
      active = false;
    };
  }, [video.videoId, isMini, isOnline, usingSharedRelated]);

  // Destroy YouTube player cleanly on unmount or when embed error occurs
  useEffect(() => {
    return () => {
      playerReadyRef.current = false;
      iframeLoadedVideoIdRef.current = null;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
        ytPlayerRef.current = null;
      }
    };
  }, []);

  // Initialize or smoothly reuse YouTube IFrame Player API
  useEffect(() => {
    if (!isOnline) {
      playerReadyRef.current = false;
      iframeLoadedVideoIdRef.current = null;
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

    // If the user clicked a suggested video directly INSIDE YouTube's iframe,
    // our auto-capture updated activeVideoId to match the video already playing inside ytPlayerRef!
    // Do NOT reload or interrupt the iframe!
    if (ytPlayerRef.current && iframeLoadedVideoIdRef.current === video.videoId && !embedError) {
      return;
    }

    // Fast path: swap video inside already-warm iframe when possible
    if (
      ytPlayerRef.current &&
      playerReadyRef.current &&
      typeof ytPlayerRef.current.loadVideoById === 'function' &&
      !embedError
    ) {
      try {
        iframeLoadedVideoIdRef.current = video.videoId;
        ytPlayerRef.current.loadVideoById({
          videoId: video.videoId,
          startSeconds: Math.floor(video.lastPositionSeconds || 0),
        });
        ytPlayerRef.current.setPlaybackRate(video.playbackRate || 1);
        return;
      } catch {
        // Fall through to full player creation
      }
    }

    let cancelled = false;

    const handleIframeSuggestionCheck = (target: YTPlayerInstance | null) => {
      if (cancelled || !target?.getVideoData) return;
      try {
        const vData = target.getVideoData();
        const nextYtId = vData?.video_id?.trim();
        if (
          nextYtId &&
          /^[a-zA-Z0-9_-]{11}$/.test(nextYtId) &&
          iframeLoadedVideoIdRef.current &&
          nextYtId !== iframeLoadedVideoIdRef.current
        ) {
          iframeLoadedVideoIdRef.current = nextYtId;
          onCaptureSuggestedRef.current?.(
            {
              videoId: nextYtId,
              title: vData.title,
              authorName: vData.author,
            },
            true
          );
        }
      } catch {
        // Ignore cross-origin timing edge
      }
    };

    const createPlayer = () => {
      if (cancelled || !ytHostRef.current || !window.YT?.Player) return;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
      }

      playerReadyRef.current = false;
      iframeLoadedVideoIdRef.current = video.videoId;
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
            playerReadyRef.current = true;
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
            handleIframeSuggestionCheck(event.target);
            const state = event.data;
            const playingNow = state === 1;
            setIsPlaying(playingNow);
            if (state === 1 || state === 3) {
              setIsEnded(false);
            }
            if (playingNow) {
              setSleepNotice(null);
              onPlaybackStartedRef.current?.();
            }
            if (state === 0) {
              setIsEnded(true);
              if (sleepModeRef.current === 'end') {
                setSleepMode('off');
                setSleepNotice('Sleep timer ended playback after this video.');
              } else if (autoNextRef.current && hasNextRef.current) {
                onNextVideoRef.current();
              }
            }
          },
          onError: (event) => {
            if (cancelled) return;
            playerReadyRef.current = false;
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
    };
  }, [video.videoId, isOnline, embedError]);

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

  // Poll playback position & detect in-iframe suggested video transitions
  useEffect(() => {
    const interval = setInterval(() => {
      const p = ytPlayerRef.current;
      if (!p || typeof p.getCurrentTime !== 'function') {
        return;
      }

      if (typeof p.getVideoData === 'function') {
        try {
          const vData = p.getVideoData();
          const nextYtId = vData?.video_id?.trim();
          if (
            nextYtId &&
            /^[a-zA-Z0-9_-]{11}$/.test(nextYtId) &&
            iframeLoadedVideoIdRef.current &&
            nextYtId !== iframeLoadedVideoIdRef.current
          ) {
            iframeLoadedVideoIdRef.current = nextYtId;
            onCaptureSuggestedRef.current?.(
              {
                videoId: nextYtId,
                title: vData.title,
                authorName: vData.author,
              },
              true
            );
            return;
          }
        } catch {
          // Ignore
        }
      }

      let time = currentTime;
      let dur = duration;
      try {
        time = p.getCurrentTime();
        const d = p.getDuration();
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

  // Sync Stage playback with Lock Screen, Notification Bar & Bluetooth headphone controls
  useEffect(() => {
    if (isMini || !isOnline) return;
    updateMediaSession(
      video,
      {
        isPlaying,
        duration,
        currentTime,
        playbackRate,
      },
      {
        onPlay: () => ytPlayerRef.current?.playVideo(),
        onPause: () => ytPlayerRef.current?.pauseVideo(),
        onNext: hasNext ? () => onNextVideoRef.current() : undefined,
        onSeekTo: (sec) => seekTo(sec),
        onSeekBy: (delta) => seekTo(Math.max(0, currentTime + delta)),
      }
    );
  }, [isMini, isOnline, video, isPlaying, duration, currentTime, playbackRate, hasNext, seekTo]);

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

  async function handleCopyText(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  async function handleCopyAllSuggestedUrls() {
    if (relatedVideos.length === 0) return;
    const allText = relatedVideos.map((v) => v.watchUrl).join('\n');
    const ok = await handleCopyText(allText);
    if (ok) {
      setCopiedAllUrls(true);
      setTimeout(() => setCopiedAllUrls(false), 2600);
    } else {
      setShowAllUrlsDrawer(true);
    }
  }

  async function handleCopySingleSuggestedUrl(videoId: string, watchUrl: string) {
    const ok = await handleCopyText(watchUrl);
    if (ok) {
      setCopiedSingleId(videoId);
      setTimeout(() => setCopiedSingleId((prev) => (prev === videoId ? null : prev)), 2000);
    } else {
      setShowAllUrlsDrawer(true);
    }
  }

  async function handleSaveAllSuggestedClick() {
    if (!onSaveAllSuggested || relatedVideos.length === 0 || savingAllRelated) return;
    setSavingAllRelated(true);
    try {
      await onSaveAllSuggested(
        relatedVideos.map((v) => ({
          videoId: v.videoId,
          title: v.title,
          authorName: v.authorName,
          authorUrl: v.authorUrl,
          durationSeconds: v.durationSeconds,
        }))
      );
    } finally {
      setSavingAllRelated(false);
    }
  }

  async function handlePasteAndPlayClick() {
    setPasteError(null);
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = (await navigator.clipboard.readText()).trim();
        const extracted = extractVideoIdFromUrl(text);
        if (extracted) {
          onCaptureSuggestedVideo?.({videoId: extracted}, true);
          setPasteBoxOpen(false);
          setPasteUrlValue('');
          return;
        }
      }
    } catch {
      // Clipboard read denied by iframe/browser policy — open inline paste box
    }
    setPasteBoxOpen((prev) => !prev);
  }

  function handleSubmitPasteUrl(e: React.FormEvent) {
    e.preventDefault();
    const extracted = extractVideoIdFromUrl(pasteUrlValue.trim());
    if (!extracted) {
      setPasteError('Valid YouTube URL paste karein (youtube.com / youtu.be)');
      return;
    }
    setPasteError(null);
    setPasteUrlValue('');
    setPasteBoxOpen(false);
    onCaptureSuggestedVideo?.({videoId: extracted}, true);
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

          {/* In-App End-Screen Suggestions Overlay (replaces YouTube's external end-screen links) */}
          {!isMini && isOnline && isEnded && !embedError && relatedVideos.length > 0 && (
            <div className="absolute inset-0 z-20 bg-black/90 backdrop-blur-md p-3 sm:p-5 flex flex-col justify-between overflow-y-auto">
              <div className="flex items-center justify-between gap-2 pb-2">
                <div className="flex items-center gap-2 text-white">
                  <Compass className="w-4 h-4 text-rose-500 shrink-0" />
                  <span className="text-xs sm:text-sm font-semibold">
                    Up Next Suggestions (Plays Inside TubeVault)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEnded(false);
                      seekTo(0);
                      ytPlayerRef.current?.playVideo();
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Replay</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEnded(false)}
                    aria-label="Close end-screen suggestions"
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 my-auto">
                {relatedVideos.slice(0, 6).map((item) => (
                  <button
                    key={item.videoId}
                    type="button"
                    onClick={() => {
                      setIsEnded(false);
                      onCaptureSuggestedVideo?.(
                        {
                          videoId: item.videoId,
                          title: item.title,
                          authorName: item.authorName,
                          authorUrl: item.authorUrl,
                          durationSeconds: item.durationSeconds,
                        },
                        true
                      );
                    }}
                    className="group text-left rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 hover:border-rose-500 overflow-hidden transition-colors cursor-pointer"
                  >
                    <div className="relative w-full aspect-video bg-black overflow-hidden">
                      <CachedThumbnail
                        videoId={item.videoId}
                        alt={item.title}
                        isOnline={isOnline}
                        fit="cover"
                        className="w-full h-full group-hover:scale-105 transition-transform"
                      />
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/35">
                        <Play className="w-6 h-6 text-white fill-current" />
                      </span>
                      {item.durationText && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 font-mono text-[10px] text-white">
                          {item.durationText}
                        </span>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-[11px] font-semibold text-white line-clamp-2 leading-snug">
                        {item.title}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400 truncate">
                        {item.authorName}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
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
                onClick={() => onUpdateVideo({...video, liked: !video.liked})}
                className={`min-h-[38px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  video.liked
                    ? 'border-rose-600 bg-rose-600/10 text-rose-600 dark:text-rose-400'
                    : 'border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                }`}
              >
                <Heart className={`w-3.5 h-3.5 text-rose-500 ${video.liked ? 'fill-current' : ''}`} />
                <span>{video.liked ? 'Liked' : 'Like'}</span>
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

          {/* Silent Auto-Save Confirmation Banner when suggested link is captured */}
          {autoSaveNotice && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{autoSaveNotice}</span>
            </div>
          )}

          {/* Native In-App Suggested Videos & All Suggested URLs Extractor */}
          {!zenMode && isOnline && (relatedLoading || relatedVideos.length > 0) && (
            <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <Compass className="w-4 h-4 text-rose-500 shrink-0" />
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Suggested Videos {relatedVideos.length > 0 ? `(${relatedVideos.length})` : ''}
                  </h2>
                </div>

                {relatedVideos.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopyAllSuggestedUrls}
                      className={`min-h-[34px] px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                        copiedAllUrls
                          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0E1117] text-slate-800 dark:text-slate-100 hover:border-rose-500/60'
                      }`}
                    >
                      {copiedAllUrls ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied All {relatedVideos.length} URLs</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-rose-500" />
                          <span>Copy All URLs ({relatedVideos.length})</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowAllUrlsDrawer((v) => !v)}
                      className={`min-h-[34px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                        showAllUrlsDrawer
                          ? 'border-rose-600 bg-rose-600/10 text-rose-600 dark:text-rose-400'
                          : 'border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                      }`}
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      <span>{showAllUrlsDrawer ? 'Hide URLs' : 'All URLs List'}</span>
                    </button>

                    {onSaveAllSuggested && (
                      <button
                        type="button"
                        onClick={handleSaveAllSuggestedClick}
                        disabled={savingAllRelated}
                        className="min-h-[34px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {savingAllRelated ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Plus className="w-3.5 h-3.5" />
                        )}
                        <span>Save All</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handlePasteAndPlayClick}
                      title="Paste copied YouTube link and play inside TubeVault"
                      className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-[#242A38] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5 text-rose-500" />
                      <span>Paste &amp; Play</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Optional 1-tap Paste Link input when user manually copied an external link */}
              {pasteBoxOpen && (
                <form
                  onSubmit={handleSubmitPasteUrl}
                  className="rounded-xl border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] p-3 flex flex-col sm:flex-row gap-2"
                >
                  <input
                    type="text"
                    value={pasteUrlValue}
                    onChange={(e) => setPasteUrlValue(e.target.value)}
                    placeholder="Yahan copied YouTube link paste karein..."
                    autoFocus
                    className="flex-1 min-h-[38px] rounded-lg border border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] px-3 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-600/50"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="min-h-[38px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      Save &amp; Play Here
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPasteBoxOpen(false);
                        setPasteError(null);
                      }}
                      className="min-h-[38px] px-2.5 rounded-lg border border-slate-200 dark:border-[#242A38] text-xs text-slate-500 cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                  {pasteError && (
                    <span className="text-[11px] text-rose-500 self-center">{pasteError}</span>
                  )}
                </form>
              )}

              {/* Expanded All Suggested URLs Drawer (every watchUrl ready to copy, select, or play) */}
              {showAllUrlsDrawer && relatedVideos.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      All {relatedVideos.length} Suggested YouTube URLs
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyAllSuggestedUrls}
                      className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copiedAllUrls ? 'Copied!' : 'Copy All'}</span>
                    </button>
                  </div>

                  <textarea
                    readOnly
                    rows={4}
                    onFocus={(e) => e.currentTarget.select()}
                    value={relatedVideos.map((v) => v.watchUrl).join('\n')}
                    aria-label="All suggested YouTube URLs"
                    className="w-full rounded-lg border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-2.5 font-mono text-[11px] text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-600/40"
                  />

                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-200/70 dark:divide-[#1E2430]">
                    {relatedVideos.map((item, idx) => (
                      <div
                        key={`url-${item.videoId}`}
                        className="py-2 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                            {idx + 1}. {item.title}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {item.watchUrl}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopySingleSuggestedUrl(item.videoId, item.watchUrl)}
                            className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-rose-500/60 cursor-pointer"
                          >
                            {copiedSingleId === item.videoId ? 'Copied' : 'Copy'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onCaptureSuggestedVideo?.(
                                {
                                  videoId: item.videoId,
                                  title: item.title,
                                  authorName: item.authorName,
                                  authorUrl: item.authorUrl,
                                  durationSeconds: item.durationSeconds,
                                },
                                true
                              )
                            }
                            className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer"
                          >
                            Play
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {relatedLoading && relatedVideos.length === 0 ? (
                <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
                  <span>Loading suggested videos &amp; URLs...</span>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {(showAllRelatedGrid ? relatedVideos : relatedVideos.slice(0, 12)).map((item) => {
                      const alreadyInLib = existingVideoIds?.has(item.videoId);
                      const isCopied = copiedSingleId === item.videoId;
                      return (
                        <div
                          key={item.videoId}
                          className="group rounded-xl border border-slate-200 dark:border-[#1E2430] hover:border-rose-500/70 bg-slate-50/60 dark:bg-[#0E1117] overflow-hidden transition-colors flex flex-col"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onCaptureSuggestedVideo?.(
                                {
                                  videoId: item.videoId,
                                  title: item.title,
                                  authorName: item.authorName,
                                  authorUrl: item.authorUrl,
                                  durationSeconds: item.durationSeconds,
                                },
                                true
                              )
                            }
                            className="text-left flex-1 flex flex-col cursor-pointer"
                          >
                            <div className="relative w-full aspect-video bg-black overflow-hidden">
                              <CachedThumbnail
                                videoId={item.videoId}
                                alt={item.title}
                                isOnline={isOnline}
                                fit="cover"
                                className="w-full h-full group-hover:scale-[1.03] transition-transform duration-200"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                              <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="w-10 h-10 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg">
                                  <Play className="w-4 h-4 fill-current ml-0.5" />
                                </span>
                              </span>
                              {item.durationText && (
                                <span className="absolute bottom-1.5 right-1.5 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white tabular-nums">
                                  {item.durationText}
                                </span>
                              )}
                              {alreadyInLib && (
                                <span className="absolute top-1.5 left-1.5 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                  Saved
                                </span>
                              )}
                            </div>

                            <div className="p-2.5 flex-1 flex flex-col justify-between gap-1">
                              <h3 className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-2 leading-snug group-hover:text-rose-500 transition-colors">
                                {item.title}
                              </h3>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {item.authorName}
                                {item.viewText ? ` · ${item.viewText}` : ''}
                              </div>
                            </div>
                          </button>

                          <div className="px-2.5 py-1.5 border-t border-slate-200/70 dark:border-[#1E2430] flex items-center justify-between gap-2 text-[11px]">
                            <span className="font-mono text-slate-400 dark:text-slate-500 truncate">
                              youtu.be/{item.videoId}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopySingleSuggestedUrl(item.videoId, item.watchUrl)}
                              className={`px-2 py-0.5 rounded font-medium inline-flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                                isCopied
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-600 dark:text-slate-300 hover:text-rose-500'
                              }`}
                            >
                              {isCopied ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy URL</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {relatedVideos.length > 12 && (
                    <div className="pt-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => setShowAllRelatedGrid((v) => !v)}
                        className="min-h-[36px] px-4 rounded-xl border border-slate-200 dark:border-[#242A38] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-rose-500/60 cursor-pointer"
                      >
                        {showAllRelatedGrid
                          ? 'Show Fewer'
                          : `Show All ${relatedVideos.length} Suggested Videos`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
