import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Disc3,
  Headphones,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import {getThumbnailBlob} from '../lib/offlineDb';
import {formatDuration} from '../lib/youtube';
import type {VideoItem} from '../types/video';
import {CachedThumbnail} from './CachedThumbnail';

interface YTMusicPlayer {
  loadVideoById: (opts: string | {videoId: string; startSeconds?: number}) => void;
  cueVideoById: (opts: string | {videoId: string; startSeconds?: number}) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setPlaybackRate: (rate: number) => void;
  mute: () => void;
  unMute: () => void;
  getPlayerState: () => number;
  destroy: () => void;
}

export type MusicRepeatMode = 'all' | 'one' | 'off';

export interface MusicController {
  activeTrack: VideoItem | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  isMuted: boolean;
  playbackRate: number;
  shuffle: boolean;
  repeatMode: MusicRepeatMode;
  errorMsg: string | null;
  playTrack: (item: VideoItem) => void;
  togglePlayPause: () => void;
  playNext: () => void;
  playPrev: () => void;
  seekTo: (seconds: number) => void;
  toggleMute: () => void;
  changeSpeed: (rate: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  stopAndClear: () => void;
}

interface UseMusicAudioEngineOptions {
  videos: VideoItem[];
  isOnline: boolean;
  pauseSignal: number;
  onPlaybackStarted: () => void;
}

export function useMusicAudioEngine({
  videos,
  isOnline,
  pauseSignal,
  onPlaybackStarted,
}: UseMusicAudioEngineOptions): {
  audioHostRef: React.RefObject<HTMLDivElement | null>;
  controller: MusicController;
} {
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTMusicPlayer | null>(null);
  const readyRef = useRef(false);
  const pendingTrackRef = useRef<{videoId: string; autoplay: boolean} | null>(null);
  const loadedYtIdRef = useRef<string | null>(null);

  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<MusicRepeatMode>('all');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeTrack = useMemo(
    () => videos.find((v) => v.id === activeTrackId) ?? null,
    [videos, activeTrackId]
  );

  const videosRef = useRef(videos);
  videosRef.current = videos;
  const activeTrackRef = useRef(activeTrack);
  activeTrackRef.current = activeTrack;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const repeatRef = useRef(repeatMode);
  repeatRef.current = repeatMode;
  const rateRef = useRef(playbackRate);
  rateRef.current = playbackRate;
  const onPlaybackStartedRef = useRef(onPlaybackStarted);
  onPlaybackStartedRef.current = onPlaybackStarted;

  const loadAndPlayByItem = useCallback((item: VideoItem) => {
    setErrorMsg(null);
    setActiveTrackId(item.id);
    setCurrentTime(0);
    setDuration(item.durationSeconds || 0);
    setIsBuffering(true);
    onPlaybackStartedRef.current();

    if (playerRef.current && readyRef.current) {
      try {
        if (loadedYtIdRef.current === item.videoId) {
          playerRef.current.playVideo();
        } else {
          loadedYtIdRef.current = item.videoId;
          playerRef.current.loadVideoById({videoId: item.videoId, startSeconds: 0});
          playerRef.current.setPlaybackRate(rateRef.current);
          playerRef.current.playVideo();
        }
      } catch {
        pendingTrackRef.current = {videoId: item.videoId, autoplay: true};
      }
    } else {
      pendingTrackRef.current = {videoId: item.videoId, autoplay: true};
    }
  }, []);

  const playNextInternal = useCallback(
    (fromEnded = false) => {
      const list = videosRef.current;
      if (list.length === 0) return;

      const cur = activeTrackRef.current;
      if (fromEnded && repeatRef.current === 'one' && cur) {
        if (playerRef.current && readyRef.current) {
          playerRef.current.seekTo(0, true);
          playerRef.current.playVideo();
        }
        return;
      }

      if (shuffleRef.current && list.length > 1) {
        const candidates = list.filter((v) => v.id !== cur?.id);
        const pick = candidates[Math.floor(Math.random() * candidates.length)] || list[0];
        loadAndPlayByItem(pick);
        return;
      }

      const idx = cur ? list.findIndex((v) => v.id === cur.id) : -1;
      const nextIdx = idx + 1;
      if (nextIdx < list.length) {
        loadAndPlayByItem(list[nextIdx]);
      } else if (repeatRef.current === 'all' || !fromEnded) {
        loadAndPlayByItem(list[0]);
      } else {
        setIsPlaying(false);
      }
    },
    [loadAndPlayByItem]
  );

  // Pre-warm a single persistent YouTube IFrame audio engine so switching tracks has ZERO iframe mount lag
  useEffect(() => {
    if (!isOnline || videos.length === 0) return;
    if (playerRef.current) return;

    let cancelled = false;
    const initialVideoId = videos[0]?.videoId;
    if (!initialVideoId) return;

    const mountWarmPlayer = () => {
      if (cancelled || !audioHostRef.current || !window.YT?.Player || playerRef.current) return;

      audioHostRef.current.innerHTML = '';
      const node = document.createElement('div');
      node.style.width = '100%';
      node.style.height = '100%';
      audioHostRef.current.appendChild(node);

      loadedYtIdRef.current = initialVideoId;

      playerRef.current = new (window.YT.Player as unknown as new (
        el: HTMLElement,
        opts: Record<string, unknown>
      ) => YTMusicPlayer)(node, {
        videoId: initialVideoId,
        width: '200',
        height: '200',
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (ev: {target: YTMusicPlayer}) => {
            if (cancelled) return;
            readyRef.current = true;
            const pending = pendingTrackRef.current;
            if (pending) {
              pendingTrackRef.current = null;
              try {
                if (loadedYtIdRef.current !== pending.videoId) {
                  loadedYtIdRef.current = pending.videoId;
                  ev.target.loadVideoById({videoId: pending.videoId, startSeconds: 0});
                }
                ev.target.setPlaybackRate(rateRef.current);
                if (pending.autoplay) ev.target.playVideo();
              } catch {
                // Ignore
              }
            }
          },
          onStateChange: (ev: {data: number; target: YTMusicPlayer}) => {
            if (cancelled) return;
            const st = ev.data;
            if (st === 1) {
              setIsPlaying(true);
              setIsBuffering(false);
              setErrorMsg(null);
              const d = ev.target.getDuration();
              if (d > 0) setDuration(d);
              onPlaybackStartedRef.current();
            } else if (st === 2) {
              setIsPlaying(false);
              setIsBuffering(false);
            } else if (st === 3) {
              setIsBuffering(true);
            } else if (st === 0) {
              setIsBuffering(false);
              playNextInternal(true);
            }
          },
          onError: (ev: {data: number}) => {
            if (cancelled) return;
            setIsBuffering(false);
            setIsPlaying(false);
            if (ev.data === 101 || ev.data === 150) {
              setErrorMsg('Audio embed blocked by owner — skipping to next track...');
              setTimeout(() => playNextInternal(false), 900);
            } else {
              setErrorMsg('Track unavailable — skipping...');
              setTimeout(() => playNextInternal(false), 900);
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      mountWarmPlayer();
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
        mountWarmPlayer();
      };
    }
  }, [isOnline, videos, playNextInternal]);

  // Cleanup player only on unmount
  useEffect(() => {
    return () => {
      readyRef.current = false;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore
        }
        playerRef.current = null;
      }
    };
  }, []);

  // Global Single-Playback Lock: pause audio engine immediately when another video plays
  useEffect(() => {
    if (pauseSignal === 0) return;
    if (playerRef.current && readyRef.current) {
      try {
        playerRef.current.pauseVideo();
      } catch {
        // Ignore
      }
    }
    setIsPlaying(false);
    setIsBuffering(false);
  }, [pauseSignal]);

  // Poll audio playback progress
  useEffect(() => {
    if (!activeTrackId || !isPlaying) return;
    const interval = setInterval(() => {
      if (!playerRef.current || !readyRef.current) return;
      try {
        const t = playerRef.current.getCurrentTime();
        const d = playerRef.current.getDuration();
        if (Number.isFinite(t)) setCurrentTime(t);
        if (Number.isFinite(d) && d > 0) setDuration(d);
      } catch {
        // Ignore
      }
    }, 400);
    return () => clearInterval(interval);
  }, [activeTrackId, isPlaying]);

  const playTrack = useCallback(
    (item: VideoItem) => {
      if (!isOnline) {
        setErrorMsg('Connect to the internet to play music audio.');
        return;
      }
      if (activeTrackRef.current?.id === item.id && playerRef.current && readyRef.current) {
        try {
          const st = playerRef.current.getPlayerState();
          if (st === 1) {
            playerRef.current.pauseVideo();
            setIsPlaying(false);
          } else {
            onPlaybackStartedRef.current();
            playerRef.current.playVideo();
            setIsPlaying(true);
          }
          return;
        } catch {
          // Fall through to full load
        }
      }
      loadAndPlayByItem(item);
    },
    [isOnline, loadAndPlayByItem]
  );

  const togglePlayPause = useCallback(() => {
    const list = videosRef.current;
    if (!activeTrackRef.current) {
      if (list[0]) loadAndPlayByItem(list[0]);
      return;
    }
    if (!playerRef.current || !readyRef.current) return;
    try {
      const st = playerRef.current.getPlayerState();
      if (st === 1) {
        playerRef.current.pauseVideo();
        setIsPlaying(false);
      } else {
        onPlaybackStartedRef.current();
        playerRef.current.playVideo();
        setIsPlaying(true);
      }
    } catch {
      // Ignore
    }
  }, [loadAndPlayByItem]);

  const playNext = useCallback(() => playNextInternal(false), [playNextInternal]);

  const playPrev = useCallback(() => {
    const list = videosRef.current;
    if (list.length === 0) return;
    if (currentTime > 4 && playerRef.current && readyRef.current) {
      playerRef.current.seekTo(0, true);
      setCurrentTime(0);
      return;
    }
    const cur = activeTrackRef.current;
    const idx = cur ? list.findIndex((v) => v.id === cur.id) : 0;
    const prevIdx = idx <= 0 ? list.length - 1 : idx - 1;
    loadAndPlayByItem(list[prevIdx]);
  }, [currentTime, loadAndPlayByItem]);

  const seekTo = useCallback((seconds: number) => {
    const clamped = Math.max(0, seconds);
    setCurrentTime(clamped);
    if (playerRef.current && readyRef.current) {
      try {
        playerRef.current.seekTo(clamped, true);
      } catch {
        // Ignore
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!playerRef.current || !readyRef.current) return;
    try {
      if (isMuted) {
        playerRef.current.unMute();
        setIsMuted(false);
      } else {
        playerRef.current.mute();
        setIsMuted(true);
      }
    } catch {
      // Ignore
    }
  }, [isMuted]);

  const changeSpeed = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (playerRef.current && readyRef.current) {
      try {
        playerRef.current.setPlaybackRate(rate);
      } catch {
        // Ignore
      }
    }
  }, []);

  const toggleShuffle = useCallback(() => setShuffle((s) => !s), []);
  const cycleRepeat = useCallback(
    () => setRepeatMode((m) => (m === 'all' ? 'one' : m === 'one' ? 'off' : 'all')),
    []
  );

  const stopAndClear = useCallback(() => {
    if (playerRef.current && readyRef.current) {
      try {
        playerRef.current.pauseVideo();
      } catch {
        // Ignore
      }
    }
    setIsPlaying(false);
    setIsBuffering(false);
    setActiveTrackId(null);
    setCurrentTime(0);
  }, []);

  return {
    audioHostRef,
    controller: {
      activeTrack,
      isPlaying,
      isBuffering,
      currentTime,
      duration,
      isMuted,
      playbackRate,
      shuffle,
      repeatMode,
      errorMsg,
      playTrack,
      togglePlayPause,
      playNext,
      playPrev,
      seekTo,
      toggleMute,
      changeSpeed,
      toggleShuffle,
      cycleRepeat,
      stopAndClear,
    },
  };
}

interface MusicPlayerViewProps {
  videos: VideoItem[];
  collections: string[];
  isOnline: boolean;
  controller: MusicController;
}

export const MusicPlayerView: React.FC<MusicPlayerViewProps> = ({
  videos,
  collections,
  isOnline,
  controller,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCollection, setActiveCollection] = useState('All');
  const [glowUrl, setGlowUrl] = useState<string | null>(null);
  const scrubberRef = useRef<HTMLDivElement | null>(null);

  const displayTrack = controller.activeTrack ?? videos[0] ?? null;

  useEffect(() => {
    if (!displayTrack) {
      setGlowUrl(null);
      return;
    }
    let active = true;
    let url: string | null = null;
    getThumbnailBlob(displayTrack.videoId).then((blob) => {
      if (blob && active) {
        url = URL.createObjectURL(blob);
        setGlowUrl(url);
      } else if (active) {
        setGlowUrl(null);
      }
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [displayTrack?.videoId]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return videos.filter((v) => {
      if (activeCollection !== 'All' && v.collection !== activeCollection) return false;
      if (q) {
        const hay = `${v.title} ${v.authorName} ${v.collection}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [videos, searchQuery, activeCollection]);

  const progressPct =
    controller.duration > 0
      ? Math.min(100, (controller.currentTime / controller.duration) * 100)
      : 0;

  function handleSeekClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!scrubberRef.current || controller.duration <= 0) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    controller.seekTo(ratio * controller.duration);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <Headphones className="w-6 h-6 text-rose-500" />
            <span>Music Audio Mode</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Click any video below to play instant sound-only audio with zero video clutter.
          </p>
        </div>

        <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {videos.length} tracks ready
        </span>
      </div>

      {!isOnline && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>Internet disconnected. Reconnect to stream music tracks.</span>
        </div>
      )}

      {videos.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-12 text-center text-sm text-slate-500">
          No videos in your library yet. Tap the bottom <strong>+</strong> button to add tracks or playlists.
        </div>
      ) : (
        <>
          {/* Audio-Only Hero Player Deck */}
          {displayTrack && (
            <div className="relative overflow-hidden rounded-3xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5 sm:p-7 shadow-xl">
              {glowUrl && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 opacity-20 dark:opacity-30 blur-3xl scale-110"
                  style={{
                    backgroundImage: `url(${glowUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
              )}

              <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-6">
                {/* Clean Full-Fit Cover Thumbnail (no video iframe shown) */}
                <div className="relative w-full md:w-56 aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-lg shrink-0">
                  <CachedThumbnail
                    videoId={displayTrack.videoId}
                    alt={displayTrack.title}
                    isOnline={isOnline}
                    fit="contain"
                    className="w-full h-full"
                  />
                  {controller.isPlaying && (
                    <div className="absolute bottom-2 left-2 rounded-md bg-black/80 px-2 py-1 inline-flex items-center gap-1.5 text-[10px] font-mono text-rose-400">
                      <Disc3 className="w-3 h-3 animate-spin" />
                      <span>AUDIO ON</span>
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-500">
                      {controller.activeTrack
                        ? controller.isBuffering
                          ? 'Starting Audio...'
                          : controller.isPlaying
                            ? 'Now Playing Audio'
                            : 'Paused'
                        : 'Ready to Play'}
                    </div>
                    <h2 className="mt-1 text-lg sm:text-xl font-bold text-slate-900 dark:text-white line-clamp-2 leading-snug">
                      {displayTrack.title}
                    </h2>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      {displayTrack.authorName} · {displayTrack.collection}
                    </div>
                  </div>

                  {controller.errorMsg && (
                    <p className="text-xs font-medium text-amber-500">{controller.errorMsg}</p>
                  )}

                  {/* Scrubber Bar */}
                  <div className="space-y-1.5">
                    <div
                      ref={scrubberRef}
                      onClick={handleSeekClick}
                      role="slider"
                      aria-label="Audio seek bar"
                      aria-valuemin={0}
                      aria-valuemax={Math.floor(controller.duration)}
                      aria-valuenow={Math.floor(controller.currentTime)}
                      tabIndex={0}
                      className="h-4 flex items-center cursor-pointer group"
                    >
                      <div className="w-full h-1.5 group-hover:h-2 transition-all rounded-full bg-slate-200 dark:bg-white/15 overflow-hidden">
                        <div
                          className="h-full bg-rose-600 rounded-full transition-[width] duration-150"
                          style={{width: `${progressPct}%`}}
                        />
                      </div>
                    </div>
                    <div className="flex justify-between font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>{formatDuration(controller.currentTime)}</span>
                      <span>
                        {formatDuration(controller.duration || displayTrack.durationSeconds || 0)}
                      </span>
                    </div>
                  </div>

                  {/* Audio Deck Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={controller.toggleShuffle}
                        title="Shuffle"
                        aria-label="Toggle shuffle"
                        className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                          controller.shuffle
                            ? 'border-rose-500/50 bg-rose-600/15 text-rose-500'
                            : 'border-slate-200 dark:border-[#242A38] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                        }`}
                      >
                        <Shuffle className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={controller.playPrev}
                        aria-label="Previous track"
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] cursor-pointer"
                      >
                        <SkipBack className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (!controller.activeTrack && displayTrack) {
                            controller.playTrack(displayTrack);
                          } else {
                            controller.togglePlayPause();
                          }
                        }}
                        disabled={!isOnline}
                        aria-label={controller.isPlaying ? 'Pause music' : 'Play music'}
                        className="min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white font-semibold text-xs inline-flex items-center gap-2 shadow-lg shadow-rose-600/25 cursor-pointer"
                      >
                        {controller.isBuffering ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : controller.isPlaying ? (
                          <Pause className="w-4 h-4 fill-current" />
                        ) : (
                          <Play className="w-4 h-4 fill-current" />
                        )}
                        <span>{controller.isPlaying ? 'Pause' : 'Play Audio'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={controller.playNext}
                        aria-label="Next track"
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] cursor-pointer"
                      >
                        <SkipForward className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={controller.cycleRepeat}
                        title={`Repeat: ${controller.repeatMode}`}
                        aria-label={`Repeat mode ${controller.repeatMode}`}
                        className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                          controller.repeatMode !== 'off'
                            ? 'border-rose-500/50 bg-rose-600/15 text-rose-500'
                            : 'border-slate-200 dark:border-[#242A38] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1C212C]'
                        }`}
                      >
                        {controller.repeatMode === 'one' ? (
                          <Repeat1 className="w-4 h-4" />
                        ) : (
                          <Repeat className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        aria-label="Audio speed"
                        value={controller.playbackRate}
                        onChange={(e) => controller.changeSpeed(Number(e.target.value))}
                        className="min-h-[38px] rounded-xl border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] px-2.5 font-mono text-xs text-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                          <option key={r} value={r}>
                            {r}x
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={controller.toggleMute}
                        aria-label={controller.isMuted ? 'Unmute audio' : 'Mute audio'}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-[#242A38] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] cursor-pointer"
                      >
                        {controller.isMuted ? (
                          <VolumeX className="w-4 h-4" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filter & Search Tracklist */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search any song or video track..."
                className="w-full min-h-[42px] rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] pl-10 pr-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-600/50"
              />
            </div>

            <select
              aria-label="Filter music by collection"
              value={activeCollection}
              onChange={(e) => setActiveCollection(e.target.value)}
              className="min-h-[40px] rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] px-3 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {['All', ...collections].map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>

          {/* All-Videos Audio Tracklist: click anywhere on any item -> instant sound! */}
          <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] divide-y divide-slate-100 dark:divide-[#1E2430] overflow-hidden">
            {filtered.map((item, idx) => {
              const isCurrent = controller.activeTrack?.id === item.id;
              const isCurrentPlaying = isCurrent && controller.isPlaying;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => controller.playTrack(item)}
                  className={`w-full px-4 py-3 flex items-center gap-3.5 text-left transition-colors cursor-pointer ${
                    isCurrent
                      ? 'bg-rose-600/[0.08] dark:bg-rose-500/[0.10]'
                      : 'hover:bg-slate-50 dark:hover:bg-[#171B24]'
                  }`}
                >
                  <div className="w-6 text-center font-mono text-xs tabular-nums shrink-0 text-slate-400">
                    {isCurrent && controller.isBuffering ? (
                      <Loader2 className="w-4 h-4 text-rose-500 animate-spin mx-auto" />
                    ) : isCurrentPlaying ? (
                      <Pause className="w-4 h-4 text-rose-500 mx-auto fill-current" />
                    ) : (
                      <span>{idx + 1}</span>
                    )}
                  </div>

                  <div className="relative w-16 aspect-video rounded-lg overflow-hidden bg-black shrink-0">
                    <CachedThumbnail
                      videoId={item.videoId}
                      alt={item.title}
                      isOnline={isOnline}
                      fit="contain"
                      className="w-full h-full"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-sm font-semibold truncate ${
                        isCurrent
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {item.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                      <span className="truncate">{item.authorName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.collection}</span>
                    </div>
                  </div>

                  <div className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                    {item.durationSeconds ? formatDuration(item.durationSeconds) : '—'}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

interface MusicMiniBarProps {
  controller: MusicController;
  isOnline: boolean;
  onOpenMusic: () => void;
}

export const MusicMiniBar: React.FC<MusicMiniBarProps> = ({
  controller,
  isOnline,
  onOpenMusic,
}) => {
  const track = controller.activeTrack;
  if (!track) return null;

  const pct =
    controller.duration > 0
      ? Math.min(100, (controller.currentTime / controller.duration) * 100)
      : 0;

  return (
    <div className="fixed bottom-16 md:bottom-5 right-3 sm:right-5 z-40 w-[calc(100vw-24px)] max-w-[380px] rounded-2xl border border-slate-200 dark:border-[#242A38] bg-white/95 dark:bg-[#13161D]/95 backdrop-blur-md shadow-2xl overflow-hidden">
      <div className="h-1 w-full bg-slate-200 dark:bg-white/10">
        <div className="h-full bg-rose-600 transition-[width] duration-200" style={{width: `${pct}%`}} />
      </div>
      <div className="p-2.5 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenMusic}
          className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer group"
        >
          <div className="w-14 aspect-video rounded-lg overflow-hidden bg-black shrink-0">
            <CachedThumbnail
              videoId={track.videoId}
              alt={track.title}
              isOnline={isOnline}
              fit="contain"
              className="w-full h-full"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-rose-500 transition-colors">
              {track.title}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono tabular-nums">
              {track.authorName} · {formatDuration(controller.currentTime)}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={controller.togglePlayPause}
            aria-label={controller.isPlaying ? 'Pause audio' : 'Play audio'}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-rose-600 hover:bg-rose-700 text-white cursor-pointer"
          >
            {controller.isPlaying ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={controller.playNext}
            aria-label="Next audio track"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1C212C] cursor-pointer"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={controller.stopAndClear}
            aria-label="Close music bar"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
