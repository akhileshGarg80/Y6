import React, {Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Clapperboard,
  Compass,
  Database,
  Film,
  Headphones,
  Home,
  Play,
  Plus,
  Search,
  WifiOff,
  X,
} from 'lucide-react';
import {CachedThumbnail} from './components/CachedThumbnail';
import {
  MusicMiniBar,
  MusicPlayerView,
  useMusicAudioEngine,
} from './components/MusicPlayerView';
import {ReelsFeedView} from './components/ReelsFeedView';
import {TopSearchResultsView} from './components/TopSearchResultsView';
import {VideoPlayerStage} from './components/VideoPlayerStage';
import {VideoQueueList} from './components/VideoQueueList';
import {useOnlineStatus} from './hooks/useOnlineStatus';
import {
  deleteVideoRecord,
  deleteVideosBulk,
  getAllVideos,
  getCachedSettingSync,
  getCachedVideosSync,
  getSetting,
  getStorageStats,
  requestPersistentStorage,
  saveThumbnailBlob,
  saveVideo,
  saveVideosBulk,
  setSetting,
} from './lib/offlineDb';
import {formatDuration} from './lib/youtube';
import type {
  ActivePlayback,
  AppView,
  RelatedVideoItem,
  StorageStats,
  SuggestedVideoInput,
  VideoChapter,
  VideoItem,
} from './types/video';

const DiscoverSearchView = lazy(() =>
  import('./components/DiscoverSearchView').then((m) => ({default: m.DiscoverSearchView}))
);
const StorageManagerView = lazy(() =>
  import('./components/StorageManagerView').then((m) => ({default: m.StorageManagerView}))
);
const QuickAddHubModal = lazy(() =>
  import('./components/QuickAddHubModal').then((m) => ({default: m.QuickAddHubModal}))
);
const SuggestionsDrawerModal = lazy(() =>
  import('./components/SuggestionsDrawerModal').then((m) => ({default: m.SuggestionsDrawerModal}))
);

const DEFAULT_COLLECTIONS = ['Watch Later', 'Suggested Hub', 'Tutorials', 'Music', 'Podcasts'];

const STARTER_VIDEO_IDS = [
  {videoId: 'aqz-KE-bpKQ', collection: 'Watch Later'},
  {videoId: 'LXb3EKWsInQ', collection: 'Watch Later'},
  {videoId: 'YE7VzlLtp-4', collection: 'Watch Later'},
  {videoId: 'M7lc1UVf-VE', collection: 'Tutorials'},
];

export default function App() {
  const {isOnline} = useOnlineStatus();

  const initialBootVideos = useMemo(() => getCachedVideosSync(), []);
  const initialTheme = useMemo(() => getCachedSettingSync<'dark' | 'light'>('theme', 'dark'), []);
  const initialActiveId = useMemo(
    () => getCachedSettingSync<string | null>('activeVideoId', null),
    []
  );
  const initialAutoHarvest = useMemo(
    () => getCachedSettingSync<boolean>('autoHarvestToHome', true),
    []
  );

  const [videos, setVideos] = useState<VideoItem[]>(initialBootVideos);
  const [loading, setLoading] = useState(initialBootVideos.length === 0);
  const [activeView, setActiveView] = useState<AppView>('home');
  const [activeVideoId, setActiveVideoId] = useState<string | null>(() => {
    if (initialActiveId && initialBootVideos.some((v) => v.id === initialActiveId)) {
      return initialActiveId;
    }
    return initialBootVideos[0]?.id ?? null;
  });
  const [autoPlaySignal, setAutoPlaySignal] = useState(0);
  const [pauseStageSignal, setPauseStageSignal] = useState(0);
  const [pauseMusicSignal, setPauseMusicSignal] = useState(0);
  const [miniPlayerVisible, setMiniPlayerVisible] = useState(false);
  const [scrolledPastStage, setScrolledPastStage] = useState(false);

  // Global Single-Playback Coordinator: strictly ONE source (stage | inline | music) plays at a time
  const [activePlayback, setActivePlayback] = useState<ActivePlayback | null>(null);

  const [showQuickAddHub, setShowQuickAddHub] = useState(false);
  const [discoverInitialQuery, setDiscoverInitialQuery] = useState<string | undefined>(undefined);
  const [topSearchQuery, setTopSearchQuery] = useState('');
  const [topSearchActiveQuery, setTopSearchActiveQuery] = useState('');
  const [topSearchOpen, setTopSearchOpen] = useState(false);
  const [topSearchNonce, setTopSearchNonce] = useState(0);
  const [topSearchFocused, setTopSearchFocused] = useState(false);
  const [liveSuggestVideos, setLiveSuggestVideos] = useState<
    Array<{
      videoId: string;
      title: string;
      authorName: string;
      authorUrl: string;
      durationText: string;
      durationSeconds: number | null;
    }>
  >([]);
  const [liveSuggestLoading, setLiveSuggestLoading] = useState(false);
  const [restoringStarters, setRestoringStarters] = useState(false);
  const [theaterMode, setTheaterMode] = useState(true);
  const [zenMode, setZenMode] = useState(false);
  const [autoNextEnabled, setAutoNextEnabled] = useState(true);
  const [darkMode, setDarkMode] = useState(initialTheme === 'dark');
  const [stats, setStats] = useState<StorageStats>({
    quotaBytes: null,
    usageBytes: null,
    videoCount: initialBootVideos.length,
    cachedThumbsCount: initialBootVideos.filter((v) => v.thumbCached).length,
  });

  const stageAnchorRef = useRef<HTMLDivElement | null>(null);
  const capturingSuggestedIdsRef = useRef<Set<string>>(new Set());
  const videosRef = useRef<VideoItem[]>(videos);
  videosRef.current = videos;
  const activeVideoRef = useRef<VideoItem | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSaveNotice, setAutoSaveNotice] = useState<string | null>(null);

  // Top-Nav Automatic Suggestions State (tracks whichever video the user clicked anywhere in the app)
  const [suggestionSource, setSuggestionSource] = useState<{
    videoId: string;
    title: string;
  } | null>(null);
  const [autoSuggestions, setAutoSuggestions] = useState<RelatedVideoItem[]>([]);
  const [autoSuggestionsLoading, setAutoSuggestionsLoading] = useState(false);
  const [showSuggestionsModal, setShowSuggestionsModal] = useState(false);
  const [autoHarvestToHome, setAutoHarvestToHome] = useState(initialAutoHarvest);
  const [hubFeedNotice, setHubFeedNotice] = useState<string | null>(null);
  const suggestionsCacheRef = useRef<Map<string, RelatedVideoItem[]>>(new Map());
  const dismissedVideoIdsRef = useRef<Set<string>>(new Set());
  const hubNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMusicPlaybackStarted = useCallback(() => {
    setActivePlayback((prev) => ({
      source: 'music',
      key: 'music',
      token: (prev?.token ?? 0) + 1,
    }));
    setPauseStageSignal((s) => s + 1);
  }, []);

  const {audioHostRef, controller: musicController} = useMusicAudioEngine({
    videos,
    isOnline,
    pauseSignal: pauseMusicSignal,
    onPlaybackStarted: handleMusicPlaybackStarted,
  });

  const refreshStats = useCallback(async () => {
    const next = await getStorageStats();
    setStats(next);
  }, []);

  const refreshLibrary = useCallback(async () => {
    const loaded = await getAllVideos();
    setVideos(loaded);
    setActiveVideoId((prev) => {
      if (prev && loaded.some((v) => v.id === prev)) return prev;
      return loaded[0]?.id ?? null;
    });
  }, []);

  const buildStarterVideos = useCallback(async (): Promise<VideoItem[]> => {
    const seeded: VideoItem[] = [];
    for (let i = 0; i < STARTER_VIDEO_IDS.length; i++) {
      const entry = STARTER_VIDEO_IDS[i];
      let title = `YouTube Video (${entry.videoId})`;
      let authorName = 'YouTube';
      let authorUrl = '';
      let description = '';
      let durationSeconds: number | null = null;
      let chapters: VideoChapter[] | undefined = undefined;
      let thumbCached = false;

      if (navigator.onLine) {
        try {
          const metaResp = await fetch(
            `/api/youtube/metadata?videoId=${encodeURIComponent(entry.videoId)}`
          );
          if (metaResp.ok) {
            const meta = (await metaResp.json()) as {
              title?: string;
              authorName?: string;
              authorUrl?: string;
              description?: string;
              durationSeconds?: number | null;
              chapters?: VideoChapter[];
            };
            if (meta.title) title = meta.title;
            if (meta.authorName) authorName = meta.authorName;
            if (meta.authorUrl) authorUrl = meta.authorUrl;
            if (meta.description) description = meta.description;
            if (meta.durationSeconds) durationSeconds = meta.durationSeconds;
            if (Array.isArray(meta.chapters)) chapters = meta.chapters;
          }
        } catch {
          // Keep fallback
        }

        try {
          const tResp = await fetch(
            `/api/youtube/thumbnail?videoId=${encodeURIComponent(entry.videoId)}`
          );
          if (tResp.ok) {
            const blob = await tResp.blob();
            await saveThumbnailBlob(entry.videoId, blob);
            thumbCached = true;
          }
        } catch {
          // Ignore
        }
      }

      seeded.push({
        id: `${entry.videoId}-${Date.now()}-${i}`,
        videoId: entry.videoId,
        originalUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
        title,
        authorName,
        authorUrl,
        description,
        durationSeconds,
        collection: entry.collection,
        addedAt: Date.now() + (STARTER_VIDEO_IDS.length - i),
        lastWatchedAt: null,
        lastPositionSeconds: 0,
        playbackRate: 1,
        bookmarks: [],
        chapters,
        notes: '',
        thumbCached,
      });
    }
    return seeded;
  }, []);

  const handleLoadStarterVideos = useCallback(async () => {
    if (restoringStarters) return;
    setRestoringStarters(true);
    try {
      const seeded = await buildStarterVideos();
      await saveVideosBulk(seeded);
      setVideos((prev) => {
        const seen = new Set(prev.map((v) => v.videoId));
        return [...prev, ...seeded.filter((s) => !seen.has(s.videoId))];
      });
      if (seeded[0]) {
        setActiveVideoId((prev) => prev || seeded[0].id);
      }
      refreshStats();
    } finally {
      setRestoringStarters(false);
    }
  }, [restoringStarters, buildStarterVideos, refreshStats]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', initialTheme === 'dark');
    requestPersistentStorage();

    async function init() {
      const [loadedVideos, savedTheme, savedActiveId, alreadyInitialized, savedAutoHarvest] =
        await Promise.all([
          getAllVideos(),
          getSetting<'dark' | 'light'>('theme', initialTheme),
          getSetting<string | null>('activeVideoId', initialActiveId),
          getSetting<boolean>('initialized', false),
          getSetting<boolean>('autoHarvestToHome', initialAutoHarvest),
        ]);

      setAutoHarvestToHome(savedAutoHarvest);
      setDarkMode(savedTheme === 'dark');
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');

      let workingVideos = loadedVideos;

      if (workingVideos.length === 0 && !alreadyInitialized) {
        await setSetting('initialized', true);
        const seeded = await buildStarterVideos();
        await saveVideosBulk(seeded);
        workingVideos = seeded;
      }

      setVideos(workingVideos);

      if (savedActiveId && workingVideos.some((v) => v.id === savedActiveId)) {
        setActiveVideoId(savedActiveId);
      } else if (workingVideos[0]) {
        setActiveVideoId(workingVideos[0].id);
      }

      await refreshStats();
      setLoading(false);
    }
    init();
  }, [refreshStats, initialTheme, initialActiveId, initialAutoHarvest, buildStarterVideos]);

  // Observe scroll past player stage -> float smoothly to Mini-Player
  useEffect(() => {
    if (activeView !== 'player' || !stageAnchorRef.current) {
      setScrolledPastStage(false);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const past = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        setScrolledPastStage(past);
        if (past) {
          setMiniPlayerVisible(true);
        }
      },
      {threshold: 0.05}
    );

    observer.observe(stageAnchorRef.current);
    return () => observer.disconnect();
  }, [activeView, videos.length]);

  const toggleTheme = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      setSetting('theme', next ? 'dark' : 'light');
      return next;
    });
  }, []);

  const collections = useMemo(() => {
    const set = new Set(DEFAULT_COLLECTIONS);
    for (const v of videos) {
      if (v.collection) set.add(v.collection);
    }
    return Array.from(set);
  }, [videos]);

  const existingVideoIds = useMemo(
    () => new Set(videos.map((v) => v.videoId)),
    [videos]
  );

  const activeVideo = useMemo(
    () => videos.find((v) => v.id === activeVideoId) ?? videos[0] ?? null,
    [videos, activeVideoId]
  );
  activeVideoRef.current = activeVideo;

  const continueWatchingVideo = useMemo(() => {
    const candidates = videos.filter((v) => v.lastPositionSeconds > 5);
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0))[0];
  }, [videos]);

  const activeInlineKey =
    activePlayback?.source === 'inline' ? activePlayback.key : null;

  // Keep Top-Nav Suggestions synced automatically to active Stage or Music video
  useEffect(() => {
    if (activePlayback?.source === 'music' && musicController.activeTrack) {
      setSuggestionSource({
        videoId: musicController.activeTrack.videoId,
        title: musicController.activeTrack.title,
      });
      return;
    }
    if (activePlayback?.source !== 'inline' && activeVideo) {
      setSuggestionSource({
        videoId: activeVideo.videoId,
        title: activeVideo.title,
      });
    }
  }, [activeVideo, activePlayback?.source, musicController.activeTrack]);

  const toggleAutoHarvest = useCallback(() => {
    setAutoHarvestToHome((prev) => {
      const next = !prev;
      setSetting('autoHarvestToHome', next);
      return next;
    });
  }, []);

  // Automatically save ALL fetched suggested URLs into Home feed so TubeVault grows into a YouTube Hub
  const harvestSuggestionsToHome = useCallback(
    async (list: RelatedVideoItem[]) => {
      if (!list || list.length === 0) return;

      const existingIds = new Set(videosRef.current.map((v) => v.videoId));
      const fresh = list.filter(
        (item) =>
          /^[a-zA-Z0-9_-]{11}$/.test(item.videoId) &&
          !existingIds.has(item.videoId) &&
          !capturingSuggestedIdsRef.current.has(item.videoId) &&
          !dismissedVideoIdsRef.current.has(item.videoId)
      );

      if (fresh.length === 0) return;

      for (const item of fresh) {
        capturingSuggestedIdsRef.current.add(item.videoId);
      }

      try {
        const minAddedAt = videosRef.current.reduce(
          (min, v) => (v.addedAt < min ? v.addedAt : min),
          Date.now()
        );

        // Anchor addedAt cleanly below existing/active items so playing cards never jump off-screen
        const created: VideoItem[] = fresh.map((item, idx) => ({
          id: `${item.videoId}-${Date.now()}-hub-${idx}`,
          videoId: item.videoId,
          originalUrl: item.watchUrl || `https://www.youtube.com/watch?v=${item.videoId}`,
          title: item.title?.trim() || `YouTube Video (${item.videoId})`,
          authorName: item.authorName?.trim() || 'YouTube Creator',
          authorUrl: item.authorUrl || '',
          description: '',
          durationSeconds: item.durationSeconds ?? null,
          collection: 'Suggested Hub',
          addedAt: minAddedAt - 10 - idx * 10,
          lastWatchedAt: null,
          lastPositionSeconds: 0,
          playbackRate: 1,
          bookmarks: [],
          notes: '',
          thumbCached: false,
        }));

        setVideos((prev) => {
          const seen = new Set(prev.map((v) => v.videoId));
          const uniqueNew = created.filter((c) => !seen.has(c.videoId));
          if (uniqueNew.length === 0) return prev;
          return [...prev, ...uniqueNew];
        });

        await saveVideosBulk(created);
        setHubFeedNotice(`+${created.length} auto-added to Home Hub`);
        if (hubNoticeTimerRef.current) clearTimeout(hubNoticeTimerRef.current);
        hubNoticeTimerRef.current = setTimeout(() => setHubFeedNotice(null), 4500);
        refreshStats();

        // Gently cache top 6 thumbnails in background without saturating bandwidth
        if (navigator.onLine) {
          const thumbBatch = created.slice(0, 6);
          const cachedIds: string[] = [];
          for (const item of thumbBatch) {
            try {
              const tResp = await fetch(
                `/api/youtube/thumbnail?videoId=${encodeURIComponent(item.videoId)}`
              );
              if (tResp.ok) {
                const blob = await tResp.blob();
                await saveThumbnailBlob(item.videoId, blob);
                cachedIds.push(item.id);
              }
            } catch {
              // Ignore thumbnail fetch hiccups
            }
          }

          if (cachedIds.length > 0) {
            const idSet = new Set(cachedIds);
            setVideos((prev) =>
              prev.map((v) => (idSet.has(v.id) ? {...v, thumbCached: true} : v))
            );
            const updatedItems = thumbBatch
              .filter((c) => idSet.has(c.id))
              .map((c) => ({...c, thumbCached: true}));
            await saveVideosBulk(updatedItems);
            refreshStats();
          }
        }
      } finally {
        for (const item of fresh) {
          capturingSuggestedIdsRef.current.delete(item.videoId);
        }
      }
    },
    [refreshStats]
  );

  // Automatically fetch ALL suggested URLs whenever suggestionSource changes, and harvest to Home Hub
  useEffect(() => {
    if (loading || !suggestionSource?.videoId || !isOnline) {
      if (!isOnline) setAutoSuggestionsLoading(false);
      return;
    }

    const ytId = suggestionSource.videoId;
    const cached = suggestionsCacheRef.current.get(ytId);
    if (cached) {
      setAutoSuggestions(cached);
      setAutoSuggestionsLoading(false);
      if (autoHarvestToHome) {
        harvestSuggestionsToHome(cached);
      }
      return;
    }

    let cancelled = false;
    setAutoSuggestionsLoading(true);
    fetch(`/api/youtube/related?videoId=${encodeURIComponent(ytId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: {related?: RelatedVideoItem[]} | null) => {
        if (cancelled) return;
        const list = Array.isArray(data?.related) ? data.related : [];
        suggestionsCacheRef.current.set(ytId, list);
        setAutoSuggestions(list);
        if (autoHarvestToHome && list.length > 0) {
          harvestSuggestionsToHome(list);
        }
      })
      .catch(() => {
        if (!cancelled) setAutoSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setAutoSuggestionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loading, suggestionSource?.videoId, isOnline, autoHarvestToHome, harvestSuggestionsToHome]);

  // Claim playback for an inline card -> pauses stage & music, AND auto-fetches suggestions for Top Nav
  const handlePlayInline = useCallback((key: string, titleHint?: string) => {
    setActivePlayback((prev) => ({
      source: 'inline',
      key,
      token: (prev?.token ?? 0) + 1,
    }));
    setPauseStageSignal((s) => s + 1);
    setPauseMusicSignal((s) => s + 1);

    if (key.startsWith('discover:')) {
      const ytId = key.slice('discover:'.length);
      if (ytId) {
        const match = videosRef.current.find((v) => v.videoId === ytId);
        setSuggestionSource({
          videoId: ytId,
          title: match?.title || titleHint || `YouTube Video (${ytId})`,
        });
      }
    } else {
      const colonIdx = key.indexOf(':');
      const itemId = colonIdx >= 0 ? key.slice(colonIdx + 1) : key;
      const match = videosRef.current.find((v) => v.id === itemId);
      if (match) {
        setSuggestionSource({videoId: match.videoId, title: match.title});
      }
    }
  }, []);

  const handleStopInline = useCallback(() => {
    setActivePlayback((prev) => (prev?.source === 'inline' ? null : prev));
  }, []);

  const handleReelPlaybackStarted = useCallback(() => {
    setActivePlayback(null);
    setPauseStageSignal((s) => s + 1);
    setPauseMusicSignal((s) => s + 1);
  }, []);

  // Claim playback for main Stage/Mini-player -> immediately stops any inline card AND pauses music audio
  const handleStagePlaybackStarted = useCallback(() => {
    setActivePlayback((prev) => ({
      source: 'stage',
      key: 'stage',
      token: (prev?.token ?? 0) + 1,
    }));
    setPauseMusicSignal((s) => s + 1);
    if (activeVideoRef.current) {
      setSuggestionSource({
        videoId: activeVideoRef.current.videoId,
        title: activeVideoRef.current.title,
      });
    }
  }, []);

  const handleSelectVideo = useCallback((id: string) => {
    setTopSearchOpen(false);
    setActivePlayback((prev) => ({
      source: 'stage',
      key: 'stage',
      token: (prev?.token ?? 0) + 1,
    }));
    setPauseMusicSignal((s) => s + 1);
    setActiveVideoId(id);
    setSetting('activeVideoId', id);
    setAutoPlaySignal((s) => s + 1);
    setActiveView('player');
    setMiniPlayerVisible(false);
    setScrolledPastStage(false);
    window.scrollTo({top: 0, behavior: 'smooth'});
  }, []);

  const handlePlayExistingByYtId = useCallback(
    (ytVideoId: string) => {
      const match = videos.find((v) => v.videoId === ytVideoId);
      if (match) {
        handleSelectVideo(match.id);
      }
    },
    [videos, handleSelectVideo]
  );

  const handleExpandFromMini = useCallback(() => {
    setActiveView('player');
    setScrolledPastStage(false);
    setMiniPlayerVisible(false);
    window.scrollTo({top: 0, behavior: 'smooth'});
  }, []);

  const handleAddedVideos = useCallback(
    (created: VideoItem[], stayInPlace = false) => {
      setVideos((prev) => [...created, ...prev]);
      if (created[0]) {
        setActivePlayback((prev) => ({
          source: 'stage',
          key: 'stage',
          token: (prev?.token ?? 0) + 1,
        }));
        setPauseMusicSignal((s) => s + 1);
        setActiveVideoId(created[0].id);
        setSetting('activeVideoId', created[0].id);
        setAutoPlaySignal((s) => s + 1);
        if (stayInPlace || activeView !== 'player' || scrolledPastStage) {
          setMiniPlayerVisible(true);
        } else {
          setActiveView('player');
        }
      }
      refreshStats();
    },
    [refreshStats, activeView, scrolledPastStage]
  );

  // Auto-save any suggested YouTube video (from native Suggested feed OR inside YouTube iframe)
  // and immediately switch playback inside TubeVault without opening external YouTube!
  const handleCaptureSuggestedVideo = useCallback(
    async (suggested: SuggestedVideoInput, playInStage = false) => {
      const ytId = suggested.videoId?.trim();
      if (!ytId || !/^[a-zA-Z0-9_-]{11}$/.test(ytId)) return;

      const showNotice = (msg: string) => {
        setAutoSaveNotice(msg);
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(() => setAutoSaveNotice(null), 4000);
      };

      setSuggestionSource({
        videoId: ytId,
        title: suggested.title?.trim() || `YouTube Video (${ytId})`,
      });

      const existing = videosRef.current.find((v) => v.videoId === ytId);
      if (existing) {
        if (playInStage) {
          setActivePlayback((prev) => ({
            source: 'stage',
            key: 'stage',
            token: (prev?.token ?? 0) + 1,
          }));
          setPauseMusicSignal((s) => s + 1);
          setActiveVideoId(existing.id);
          setSetting('activeVideoId', existing.id);
          setAutoPlaySignal((s) => s + 1);
          setActiveView('player');
          setMiniPlayerVisible(false);
          setScrolledPastStage(false);
          showNotice(`Playing saved video: ${existing.title}`);
        }
        return;
      }

      if (capturingSuggestedIdsRef.current.has(ytId)) return;
      capturingSuggestedIdsRef.current.add(ytId);

      try {
        const now = Date.now();
        const itemId = `${ytId}-${now}`;
        const initialTitle = suggested.title?.trim() || `YouTube Video (${ytId})`;
        const initialAuthor = suggested.authorName?.trim() || 'YouTube Creator';
        const collection = activeVideoRef.current?.collection || 'Watch Later';

        const draftItem: VideoItem = {
          id: itemId,
          videoId: ytId,
          originalUrl: `https://www.youtube.com/watch?v=${ytId}`,
          title: initialTitle,
          authorName: initialAuthor,
          authorUrl: suggested.authorUrl || '',
          description: '',
          durationSeconds: suggested.durationSeconds ?? null,
          collection,
          addedAt: now,
          lastWatchedAt: playInStage ? now : null,
          lastPositionSeconds: 0,
          playbackRate: 1,
          bookmarks: [],
          notes: '',
          thumbCached: false,
        };

        // Immediately save & switch playback with zero delay
        setVideos((prev) => (prev.some((v) => v.videoId === ytId) ? prev : [draftItem, ...prev]));
        await saveVideo(draftItem);

        if (playInStage) {
          setActivePlayback((prev) => ({
            source: 'stage',
            key: 'stage',
            token: (prev?.token ?? 0) + 1,
          }));
          setPauseMusicSignal((s) => s + 1);
          setActiveVideoId(draftItem.id);
          setSetting('activeVideoId', draftItem.id);
          setAutoPlaySignal((s) => s + 1);
          setActiveView('player');
          setMiniPlayerVisible(false);
          setScrolledPastStage(false);
        }

        showNotice(`Auto-saved link & playing: ${initialTitle}`);

        // Silently enrich full metadata, chapters & cached thumbnail in background
        let enriched = {...draftItem};
        if (navigator.onLine) {
          const [metaResult, thumbResult] = await Promise.allSettled([
            fetch(`/api/youtube/metadata?videoId=${encodeURIComponent(ytId)}`).then((r) =>
              r.ok ? r.json() : null
            ),
            fetch(`/api/youtube/thumbnail?videoId=${encodeURIComponent(ytId)}`).then((r) =>
              r.ok ? r.blob() : null
            ),
          ]);

          if (metaResult.status === 'fulfilled' && metaResult.value) {
            const meta = metaResult.value as {
              title?: string;
              authorName?: string;
              authorUrl?: string;
              description?: string;
              durationSeconds?: number | null;
              chapters?: VideoChapter[];
            };
            enriched = {
              ...enriched,
              title: meta.title || enriched.title,
              authorName: meta.authorName || enriched.authorName,
              authorUrl: meta.authorUrl || enriched.authorUrl,
              description: meta.description || enriched.description,
              durationSeconds: meta.durationSeconds ?? enriched.durationSeconds,
              chapters: Array.isArray(meta.chapters) ? meta.chapters : enriched.chapters,
            };
          }

          if (thumbResult.status === 'fulfilled' && thumbResult.value) {
            await saveThumbnailBlob(ytId, thumbResult.value);
            enriched = {...enriched, thumbCached: true};
          }

          setVideos((prev) =>
            prev.map((v) =>
              v.id === itemId
                ? {
                    ...v,
                    title: enriched.title,
                    authorName: enriched.authorName,
                    authorUrl: enriched.authorUrl,
                    description: enriched.description,
                    durationSeconds: enriched.durationSeconds ?? v.durationSeconds,
                    chapters: enriched.chapters ?? v.chapters,
                    thumbCached: enriched.thumbCached || v.thumbCached,
                  }
                : v
            )
          );
          await saveVideo(enriched);
        }

        refreshStats();
      } finally {
        capturingSuggestedIdsRef.current.delete(ytId);
      }
    },
    [refreshStats]
  );

  const handleSaveAllSuggested = useCallback(
    async (items: SuggestedVideoInput[]): Promise<number> => {
      const existingIds = new Set(videosRef.current.map((v) => v.videoId));
      const fresh = items.filter(
        (item) => /^[a-zA-Z0-9_-]{11}$/.test(item.videoId) && !existingIds.has(item.videoId)
      );
      if (fresh.length === 0) return 0;

      const collection = activeVideoRef.current?.collection || 'Watch Later';
      const now = Date.now();
      const created: VideoItem[] = fresh.map((item, idx) => ({
        id: `${item.videoId}-${now}-${idx}`,
        videoId: item.videoId,
        originalUrl: `https://www.youtube.com/watch?v=${item.videoId}`,
        title: item.title?.trim() || `YouTube Video (${item.videoId})`,
        authorName: item.authorName?.trim() || 'YouTube Creator',
        authorUrl: item.authorUrl || '',
        description: '',
        durationSeconds: item.durationSeconds ?? null,
        collection,
        addedAt: now + (fresh.length - idx),
        lastWatchedAt: null,
        lastPositionSeconds: 0,
        playbackRate: 1,
        bookmarks: [],
        notes: '',
        thumbCached: false,
      }));

      setVideos((prev) => {
        const seen = new Set(prev.map((v) => v.videoId));
        return [...created.filter((c) => !seen.has(c.videoId)), ...prev];
      });
      await saveVideosBulk(created);

      setAutoSaveNotice(`Saved ${created.length} suggested video URLs to your Library!`);
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => setAutoSaveNotice(null), 4000);

      if (navigator.onLine) {
        Promise.all(
          created.map(async (item) => {
            try {
              const tResp = await fetch(
                `/api/youtube/thumbnail?videoId=${encodeURIComponent(item.videoId)}`
              );
              if (tResp.ok) {
                const blob = await tResp.blob();
                await saveThumbnailBlob(item.videoId, blob);
                return item.id;
              }
            } catch {
              // Ignore thumbnail errors on bulk save
            }
            return null;
          })
        ).then(async (cachedIds) => {
          const idSet = new Set(cachedIds.filter(Boolean) as string[]);
          if (idSet.size > 0) {
            setVideos((prev) =>
              prev.map((v) => (idSet.has(v.id) ? {...v, thumbCached: true} : v))
            );
            const updatedItems = created
              .filter((c) => idSet.has(c.id))
              .map((c) => ({...c, thumbCached: true}));
            await saveVideosBulk(updatedItems);
          }
          refreshStats();
        });
      } else {
        refreshStats();
      }

      return created.length;
    },
    [refreshStats]
  );

  const handleUpdateVideo = useCallback(async (updated: VideoItem) => {
    setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    await saveVideo(updated);
  }, []);

  const handleToggleLike = useCallback(async (target: VideoItem) => {
    const nextItem: VideoItem = {...target, liked: !target.liked};
    setVideos((prev) => prev.map((v) => (v.id === target.id ? nextItem : v)));
    await saveVideo(nextItem);
  }, []);

  const handleSaveAndLikeVideo = useCallback(
    async (suggested: SuggestedVideoInput) => {
      const ytId = suggested.videoId?.trim();
      if (!ytId) return;
      const existing = videosRef.current.find((v) => v.videoId === ytId);
      if (existing) {
        const nextItem: VideoItem = {...existing, liked: !existing.liked};
        setVideos((prev) => prev.map((v) => (v.id === existing.id ? nextItem : v)));
        await saveVideo(nextItem);
        return;
      }
      const now = Date.now();
      const item: VideoItem = {
        id: `${ytId}-${now}`,
        videoId: ytId,
        originalUrl: `https://www.youtube.com/watch?v=${ytId}`,
        title: suggested.title?.trim() || `YouTube Video (${ytId})`,
        authorName: suggested.authorName?.trim() || 'YouTube Creator',
        authorUrl: suggested.authorUrl || '',
        description: '',
        durationSeconds: suggested.durationSeconds ?? null,
        collection: 'Watch Later',
        addedAt: now,
        lastWatchedAt: null,
        lastPositionSeconds: 0,
        playbackRate: 1,
        bookmarks: [],
        notes: '',
        liked: true,
        thumbCached: false,
      };
      setVideos((prev) => [item, ...prev]);
      await saveVideo(item);
      refreshStats();
    },
    [refreshStats]
  );

  const handlePlaySearchInMusic = useCallback(
    async (suggested: SuggestedVideoInput) => {
      const ytId = suggested.videoId?.trim();
      if (!ytId) return;
      const existing = videosRef.current.find((v) => v.videoId === ytId);
      if (existing) {
        musicController.playTrack(existing);
        return;
      }
      const now = Date.now();
      const item: VideoItem = {
        id: `${ytId}-${now}`,
        videoId: ytId,
        originalUrl: `https://www.youtube.com/watch?v=${ytId}`,
        title: suggested.title?.trim() || `YouTube Video (${ytId})`,
        authorName: suggested.authorName?.trim() || 'YouTube Creator',
        authorUrl: suggested.authorUrl || '',
        description: '',
        durationSeconds: suggested.durationSeconds ?? null,
        collection: 'Music',
        addedAt: now,
        lastWatchedAt: now,
        lastPositionSeconds: 0,
        playbackRate: 1,
        bookmarks: [],
        notes: '',
        thumbCached: false,
      };
      setVideos((prev) => (prev.some((v) => v.videoId === ytId) ? prev : [item, ...prev]));
      await saveVideo(item);
      musicController.playTrack(item);
      refreshStats();
    },
    [musicController, refreshStats]
  );

  const handleDeleteVideo = useCallback(
    async (target: VideoItem) => {
      dismissedVideoIdsRef.current.add(target.videoId);
      await deleteVideoRecord(target.id, target.videoId);
      setVideos((prev) => {
        const next = prev.filter((v) => v.id !== target.id);
        if (activeVideoId === target.id) {
          const nextActive = next[0]?.id ?? null;
          setActiveVideoId(nextActive);
          setSetting('activeVideoId', nextActive);
        }
        return next;
      });
      refreshStats();
    },
    [activeVideoId, refreshStats]
  );

  const handleBulkDeleteVideos = useCallback(
    async (includeLiked: boolean): Promise<number> => {
      const targets = includeLiked
        ? videosRef.current
        : videosRef.current.filter((v) => !v.liked);
      if (targets.length === 0) return 0;

      for (const t of targets) {
        dismissedVideoIdsRef.current.add(t.videoId);
      }

      const targetIds = new Set(targets.map((t) => t.id));
      await deleteVideosBulk(targets.map((t) => ({id: t.id, videoId: t.videoId})));

      setVideos((prev) => {
        const next = prev.filter((v) => !targetIds.has(v.id));
        if (activeVideoId && targetIds.has(activeVideoId)) {
          const nextActive = next[0]?.id ?? null;
          setActiveVideoId(nextActive);
          setSetting('activeVideoId', nextActive);
        }
        return next;
      });
      refreshStats();
      return targets.length;
    },
    [activeVideoId, refreshStats]
  );

  const handleMoveVideo = useCallback(
    async (id: string, direction: 'up' | 'down') => {
      const idx = videos.findIndex((v) => v.id === id);
      if (idx < 0) return;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= videos.length) return;

      const copy = [...videos];
      const temp = copy[idx];
      copy[idx] = copy[swapIdx];
      copy[swapIdx] = temp;

      const baseTime = Date.now();
      const reordered = copy.map((item, i) => ({
        ...item,
        addedAt: baseTime - i * 10,
      }));
      setVideos(reordered);
      await saveVideosBulk(reordered);
    },
    [videos]
  );

  const handlePlayNext = useCallback(
    async (id: string) => {
      const target = videos.find((v) => v.id === id);
      if (!target) return;
      const rest = videos.filter((v) => v.id !== id);
      const currentIdx = activeVideoId ? rest.findIndex((v) => v.id === activeVideoId) : -1;
      const insertAt = currentIdx >= 0 ? currentIdx + 1 : 0;
      const copy = [...rest];
      copy.splice(insertAt, 0, target);

      const baseTime = Date.now();
      const reordered = copy.map((item, i) => ({
        ...item,
        addedAt: baseTime - i * 10,
      }));
      setVideos(reordered);
      await saveVideosBulk(reordered);
    },
    [videos, activeVideoId]
  );

  const activeIndex = activeVideo ? videos.findIndex((v) => v.id === activeVideo.id) : -1;
  const hasNext = activeIndex >= 0 && activeIndex < videos.length - 1;

  const handleNextVideo = useCallback(() => {
    if (!hasNext) return;
    const nextItem = videos[activeIndex + 1];
    if (nextItem) {
      handleSelectVideo(nextItem.id);
    }
  }, [hasNext, videos, activeIndex, handleSelectVideo]);

  const navItems: Array<{id: AppView; label: string}> = [
    {id: 'home', label: 'Home'},
    {id: 'reels', label: 'Reels'},
    {id: 'music', label: 'Music'},
    {id: 'player', label: 'Player'},
    {id: 'discover', label: 'Discover'},
    {id: 'storage', label: 'Library'},
  ];

  const isFloatingMini =
    Boolean(activeVideo) &&
    activeView !== 'reels' &&
    ((activeView !== 'player' && activeView !== 'music' && miniPlayerVisible) ||
      (activeView === 'player' && scrolledPastStage && miniPlayerVisible));

  const showTopPlayerStage = activeView === 'player' && !isFloatingMini;

  const showMusicMiniBar =
    activeView !== 'music' &&
    activeView !== 'reels' &&
    Boolean(musicController.activeTrack) &&
    !isFloatingMini;

  const quickSearchMatches = useMemo(() => {
    const q = topSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return videos
      .filter((v) =>
        `${v.title} ${v.authorName} ${v.collection}`.toLowerCase().includes(q)
      )
      .slice(0, 4);
  }, [videos, topSearchQuery]);

  // Live debounced YouTube suggestions in Top Nav dropdown (YouTube feel)
  useEffect(() => {
    const q = topSearchQuery.trim();
    if (!topSearchFocused || topSearchOpen || q.length < 2 || !isOnline) {
      if (q.length < 2) {
        setLiveSuggestVideos([]);
        setLiveSuggestLoading(false);
      }
      return;
    }

    const controller = new AbortController();
    setLiveSuggestLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/youtube/search?q=${encodeURIComponent(q)}&filter=videos`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (
            data: {
              videos?: Array<{
                videoId: string;
                title: string;
                authorName: string;
                authorUrl: string;
                durationText: string;
                durationSeconds: number | null;
              }>;
            } | null
          ) => {
            if (!controller.signal.aborted) {
              setLiveSuggestVideos(Array.isArray(data?.videos) ? data.videos.slice(0, 5) : []);
            }
          }
        )
        .catch(() => {
          if (!controller.signal.aborted) setLiveSuggestVideos([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLiveSuggestLoading(false);
        });
    }, 320);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [topSearchQuery, topSearchFocused, topSearchOpen, isOnline]);

  const openDirectTopSearch = (rawQuery: string) => {
    const q = rawQuery.trim();
    if (!q) return;
    setTopSearchFocused(false);
    setTopSearchActiveQuery(q);
    setTopSearchOpen(true);
    setTopSearchNonce((n) => n + 1);
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  const handleTopSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    openDirectTopSearch(topSearchQuery);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#0B0D11] dark:text-slate-100">
      {/* Persistent Warm Audio-Only YouTube Engine (in-viewport -z-10 prevents offscreen occlusion throttling) */}
      <div
        ref={audioHostRef}
        aria-hidden="true"
        className="fixed bottom-0 left-0 -z-10 w-[200px] h-[112px] opacity-[0.01] pointer-events-none overflow-hidden"
      />

      {/* Clean Top Bar: Brand + Nav Tabs + Direct YouTube-style Search Bar */}
      <header className="sticky top-0 z-30 h-[56px] md:h-16 border-b border-slate-200 dark:border-[#1E2430] bg-white/95 dark:bg-[#0B0D11]/95 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto h-full px-3 sm:px-6 flex items-center justify-between gap-2.5 sm:gap-5">
          <button
            type="button"
            onClick={() => {
              setTopSearchOpen(false);
              setActiveView('home');
              window.scrollTo({top: 0, behavior: 'smooth'});
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            TubeVault
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium shrink-0">
            {navItems.map((item) => {
              const active = !topSearchOpen && activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTopSearchOpen(false);
                    setActiveView(item.id);
                    if (item.id === 'player') {
                      setMiniPlayerVisible(false);
                    }
                  }}
                  className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-rose-600 text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Direct YouTube-style Top Nav Search Bar (searches right here without switching bottom tabs) */}
          <form
            onSubmit={handleTopSearchSubmit}
            className="relative flex-1 max-w-md ml-auto"
          >
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                type="search"
                value={topSearchQuery}
                onFocus={() => setTopSearchFocused(true)}
                onBlur={() => setTimeout(() => setTopSearchFocused(false), 180)}
                onChange={(e) => {
                  const val = e.target.value;
                  setTopSearchQuery(val);
                  if (!val.trim() && topSearchOpen) {
                    setTopSearchOpen(false);
                  }
                }}
                placeholder="Search YouTube..."
                aria-label="Search YouTube or saved videos"
                className="w-full min-h-[38px] md:min-h-[40px] rounded-xl border border-slate-200 dark:border-[#242A38] bg-slate-100/80 dark:bg-[#13161D] pl-9 pr-20 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-600/50 focus:bg-white dark:focus:bg-[#171B24]"
              />
              {topSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setTopSearchQuery('');
                    setLiveSuggestVideos([]);
                    setTopSearchOpen(false);
                  }}
                  aria-label="Clear search"
                  className="absolute right-11 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="submit"
                aria-label="Search YouTube"
                title="Search YouTube"
                className="absolute right-1 min-h-[30px] min-w-[34px] px-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Live YouTube + Saved Dropdown while typing */}
            {topSearchFocused && !topSearchOpen && topSearchQuery.trim().length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-2 rounded-2xl border border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] shadow-2xl overflow-hidden z-50">
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1E2430]">
                  {quickSearchMatches.map((m) => (
                    <button
                      key={`saved-${m.id}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTopSearchFocused(false);
                        setTopSearchOpen(false);
                        handleSelectVideo(m.id);
                      }}
                      className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-slate-50 dark:hover:bg-[#171B24] cursor-pointer"
                    >
                      <div className="w-12 aspect-video rounded bg-black overflow-hidden shrink-0">
                        <CachedThumbnail
                          videoId={m.videoId}
                          alt={m.title}
                          isOnline={isOnline}
                          fit="cover"
                          className="w-full h-full"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {m.title}
                        </div>
                        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 truncate">
                          Saved · {m.authorName}
                        </div>
                      </div>
                    </button>
                  ))}

                  {liveSuggestVideos.map((v) => (
                    <button
                      key={`yt-${v.videoId}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTopSearchFocused(false);
                        setTopSearchOpen(false);
                        handleCaptureSuggestedVideo(
                          {
                            videoId: v.videoId,
                            title: v.title,
                            authorName: v.authorName,
                            authorUrl: v.authorUrl,
                            durationSeconds: v.durationSeconds,
                          },
                          true
                        );
                      }}
                      className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-slate-50 dark:hover:bg-[#171B24] cursor-pointer"
                    >
                      <div className="w-12 aspect-video rounded bg-black overflow-hidden shrink-0">
                        <CachedThumbnail
                          videoId={v.videoId}
                          alt={v.title}
                          isOnline={isOnline}
                          fit="cover"
                          className="w-full h-full"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {v.title}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          YouTube · {v.authorName}
                          {v.durationText ? ` · ${v.durationText}` : ''}
                        </div>
                      </div>
                    </button>
                  ))}

                  {liveSuggestLoading && liveSuggestVideos.length === 0 && (
                    <div className="px-3.5 py-2.5 text-xs text-slate-400">
                      Searching YouTube...
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openDirectTopSearch(topSearchQuery);
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#0B0D11] border-t border-slate-100 dark:border-[#1E2430] text-left text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-600/10 flex items-center gap-2 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    Show all results for &ldquo;{topSearchQuery.trim()}&rdquo;
                  </span>
                </button>
              </div>
            )}
          </form>
        </div>
      </header>

      <main
        className={
          activeView === 'reels' && !topSearchOpen
            ? 'flex-1 w-full max-w-[1440px] mx-auto px-2.5 sm:px-6 pt-0 pb-14 md:py-3'
            : 'flex-1 w-full max-w-[1440px] mx-auto px-2.5 sm:px-6 py-4 sm:py-5 pb-28 md:pb-24'
        }
      >
        {loading ? (
          <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-12 text-center text-sm text-slate-500">
            Loading your TubeVault feed...
          </div>
        ) : topSearchOpen ? (
          <TopSearchResultsView
            query={topSearchActiveQuery || topSearchQuery}
            searchNonce={topSearchNonce}
            videos={videos}
            existingVideoIds={existingVideoIds}
            isOnline={isOnline}
            activeInlineKey={activeInlineKey}
            onPlayInline={handlePlayInline}
            onStopInline={handleStopInline}
            onCaptureSuggestedVideo={handleCaptureSuggestedVideo}
            onSaveAndLikeVideo={handleSaveAndLikeVideo}
            onPlayInMusic={handlePlaySearchInMusic}
            onSelectSavedVideo={handleSelectVideo}
            onToggleLikeSaved={handleToggleLike}
            onClose={() => setTopSearchOpen(false)}
          />
        ) : activeView === 'reels' ? (
          <ReelsFeedView
            videos={videos}
            existingVideoIds={existingVideoIds}
            isOnline={isOnline}
            onReelPlaybackStarted={handleReelPlaybackStarted}
            onSaveReel={(s) => handleCaptureSuggestedVideo(s, false)}
            onSaveAndLikeReel={handleSaveAndLikeVideo}
            onPlayReelInMusic={handlePlaySearchInMusic}
            onOpenReelInPlayer={(s) => handleCaptureSuggestedVideo(s, true)}
            onToggleLikeSaved={handleToggleLike}
          />
        ) : activeView === 'music' ? (
          <MusicPlayerView
            videos={videos}
            collections={collections}
            isOnline={isOnline}
            controller={musicController}
            onToggleLike={handleToggleLike}
            onLoadStarters={handleLoadStarterVideos}
          />
        ) : activeView === 'discover' ? (
          <Suspense
            fallback={
              <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-10 text-center text-xs text-slate-500">
                Loading Discover...
              </div>
            }
          >
            <DiscoverSearchView
              existingVideoIds={existingVideoIds}
              collections={collections}
              isOnline={isOnline}
              activeInlineKey={activeInlineKey}
              onPlayInline={handlePlayInline}
              onStopInline={handleStopInline}
              onCaptureSuggestedVideo={(s) => handleCaptureSuggestedVideo(s, false)}
              initialQuery={discoverInitialQuery}
              onAdded={handleAddedVideos}
              onPlayExisting={handlePlayExistingByYtId}
            />
          </Suspense>
        ) : activeView === 'storage' ? (
          <Suspense
            fallback={
              <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-10 text-center text-xs text-slate-500">
                Loading Library...
              </div>
            }
          >
            <StorageManagerView
              stats={stats}
              videos={videos}
              isOnline={isOnline}
              darkMode={darkMode}
              autoSuggestionsCount={autoSuggestions.length}
              autoSuggestionsLoading={autoSuggestionsLoading}
              onToggleTheme={toggleTheme}
              onOpenSuggestions={() => setShowSuggestionsModal(true)}
              onOpenAddHub={() => setShowQuickAddHub(true)}
              onToggleLike={handleToggleLike}
              onSelectVideo={handleSelectVideo}
              onDeleteSingleVideo={handleDeleteVideo}
              onBulkDeleteVideos={handleBulkDeleteVideos}
              onRefreshLibrary={refreshLibrary}
              onStatsChange={refreshStats}
            />
          </Suspense>
        ) : activeView === 'home' ? (
          videos.length === 0 ? (
            <div className="max-w-xl mx-auto py-16 text-center space-y-4">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-rose-600/10 border border-rose-600/20 flex items-center justify-center text-rose-600 dark:text-rose-500">
                <Film className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Your TubeVault Feed is Empty
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Search YouTube in the top bar, tap <strong>+</strong> to add links, or load starter videos.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowQuickAddHub(true)}
                  className="min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Videos or Music</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoadStarterVideos}
                  disabled={restoringStarters}
                  className="min-h-[44px] px-5 rounded-xl border border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] text-slate-800 dark:text-slate-100 text-sm font-semibold hover:border-rose-500/60 disabled:opacity-50 cursor-pointer"
                >
                  {restoringStarters ? 'Loading...' : 'Load Starter Videos'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                    Listen &amp; Watch
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    <span>{videos.length} videos</span>
                    <span aria-hidden="true">·</span>
                    <span>{stats.cachedThumbsCount} thumbs cached</span>
                    <span aria-hidden="true">·</span>
                    <span>{collections.length} collections</span>
                    {hubFeedNotice && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          {hubFeedNotice}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={toggleAutoHarvest}
                  title="Automatically save suggested video URLs to your Home feed as you watch"
                  className={`min-h-[36px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                    autoHarvestToHome
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5 shrink-0" />
                  <span>Auto-Hub: {autoHarvestToHome ? 'On' : 'Off'}</span>
                </button>
              </div>

              {/* Continue Watching Spotlight Strip */}
              {continueWatchingVideo && (
                <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => handleSelectVideo(continueWatchingVideo.id)}
                    className="flex items-center gap-3.5 min-w-0 text-left flex-1 group cursor-pointer"
                  >
                    <div className="relative w-32 aspect-video rounded-xl overflow-hidden bg-black shrink-0">
                      <CachedThumbnail
                        videoId={continueWatchingVideo.videoId}
                        alt={continueWatchingVideo.title}
                        isOnline={isOnline}
                        fit="contain"
                        className="w-full h-full"
                      />
                      {continueWatchingVideo.durationSeconds &&
                        continueWatchingVideo.durationSeconds > 0 && (
                          <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20">
                            <div
                              className="h-full bg-rose-600"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.round(
                                    (continueWatchingVideo.lastPositionSeconds /
                                      continueWatchingVideo.durationSeconds) *
                                      100
                                  )
                                )}%`,
                              }}
                            />
                          </div>
                        )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-500">
                        Continue Playing
                      </div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-rose-500 transition-colors">
                        {continueWatchingVideo.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                        {continueWatchingVideo.authorName} · Paused at{' '}
                        {formatDuration(continueWatchingVideo.lastPositionSeconds)}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectVideo(continueWatchingVideo.id)}
                    className="min-h-[40px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Resume</span>
                  </button>
                </div>
              )}

              <VideoQueueList
                videos={videos}
                activeVideoId={activeVideo?.id ?? null}
                isOnline={isOnline}
                collections={collections}
                activeInlineKey={activeInlineKey}
                keyPrefix="home"
                onPlayInline={handlePlayInline}
                onStopInline={handleStopInline}
                onCaptureSuggestedVideo={(s) => handleCaptureSuggestedVideo(s, false)}
                onSelectVideo={handleSelectVideo}
                onMoveVideo={handleMoveVideo}
                onPlayNext={handlePlayNext}
                onToggleLike={handleToggleLike}
                onDeleteVideo={handleDeleteVideo}
                layout="grid"
              />
            </div>
          )
        ) : videos.length === 0 ? (
          <div className="max-w-xl mx-auto py-16 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-rose-600/10 border border-rose-600/20 flex items-center justify-center text-rose-600 dark:text-rose-500">
              <Film className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Nothing in player yet
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Tap the <strong>+</strong> icon at the bottom to add YouTube links, playlists, or search channels.
            </p>
            <button
              type="button"
              onClick={() => setShowQuickAddHub(true)}
              className="min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Videos</span>
            </button>
          </div>
        ) : null}

        {/* Persistent Player + Queue Layout */}
        {!loading && !topSearchOpen && videos.length > 0 && activeVideo && (
          <div
            className={
              activeView === 'player'
                ? `grid gap-6 items-start ${
                    zenMode
                      ? 'grid-cols-1 max-w-5xl mx-auto'
                      : theaterMode
                        ? 'grid-cols-1'
                        : 'grid-cols-1 lg:grid-cols-12'
                  }`
                : ''
            }
          >
            {activeView === 'player' && (
              <div
                ref={stageAnchorRef}
                className={zenMode || theaterMode ? 'w-full' : 'lg:col-span-8'}
              >
                {isFloatingMini && (
                  <div className="w-full aspect-video rounded-2xl border border-dashed border-slate-200 dark:border-[#1E2430] bg-slate-100/50 dark:bg-[#13161D]/40 flex flex-col items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>Playing in floating mini-player</span>
                    <button
                      type="button"
                      onClick={handleExpandFromMini}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold cursor-pointer"
                    >
                      Return Video Here
                    </button>
                  </div>
                )}

                {showTopPlayerStage && (
                  <VideoPlayerStage
                    video={activeVideo}
                    autoPlaySignal={autoPlaySignal}
                    pauseSignal={pauseStageSignal}
                    onPlaybackStarted={handleStagePlaybackStarted}
                    onCaptureSuggestedVideo={handleCaptureSuggestedVideo}
                    onSaveAllSuggested={handleSaveAllSuggested}
                    sharedRelatedVideos={autoSuggestions}
                    sharedRelatedLoading={autoSuggestionsLoading}
                    sharedRelatedForVideoId={suggestionSource?.videoId ?? null}
                    existingVideoIds={existingVideoIds}
                    autoSaveNotice={autoSaveNotice}
                    isOnline={isOnline}
                    isMini={false}
                    theaterMode={theaterMode}
                    zenMode={zenMode}
                    autoNextEnabled={autoNextEnabled}
                    onToggleTheater={() => setTheaterMode((v) => !v)}
                    onToggleZen={() => setZenMode((v) => !v)}
                    onToggleAutoNext={() => setAutoNextEnabled((v) => !v)}
                    onExpandFromMini={handleExpandFromMini}
                    onDismissMini={() => setMiniPlayerVisible(false)}
                    onUpdateVideo={handleUpdateVideo}
                    onNextVideo={handleNextVideo}
                    hasNext={hasNext}
                  />
                )}
              </div>
            )}

            {/* Floating Video Mini-Player */}
            {isFloatingMini && (
              <div className="fixed bottom-16 md:bottom-5 right-3 sm:right-5 z-40 w-[calc(100vw-24px)] max-w-[380px] sm:w-[340px]">
                <VideoPlayerStage
                  video={activeVideo}
                  autoPlaySignal={autoPlaySignal}
                  pauseSignal={pauseStageSignal}
                  onPlaybackStarted={handleStagePlaybackStarted}
                  onCaptureSuggestedVideo={handleCaptureSuggestedVideo}
                  existingVideoIds={existingVideoIds}
                  isOnline={isOnline}
                  isMini={true}
                  theaterMode={false}
                  zenMode={false}
                  autoNextEnabled={autoNextEnabled}
                  onToggleTheater={() => setTheaterMode((v) => !v)}
                  onToggleZen={() => setZenMode((v) => !v)}
                  onToggleAutoNext={() => setAutoNextEnabled((v) => !v)}
                  onExpandFromMini={handleExpandFromMini}
                  onDismissMini={() => setMiniPlayerVisible(false)}
                  onUpdateVideo={handleUpdateVideo}
                  onNextVideo={handleNextVideo}
                  hasNext={hasNext}
                />
              </div>
            )}

            {/* Queue Sidebar (hidden cleanly when Zen Focus Mode is active) */}
            {activeView === 'player' && !zenMode && (
              <aside className={theaterMode ? 'w-full' : 'lg:col-span-4 lg:sticky lg:top-20'}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Up Next Queue
                  </h2>
                  <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {videos.length} items
                  </span>
                </div>
                <VideoQueueList
                  videos={videos}
                  activeVideoId={activeVideo?.id ?? null}
                  isOnline={isOnline}
                  collections={collections}
                  activeInlineKey={activeInlineKey}
                  keyPrefix="queue"
                  onPlayInline={handlePlayInline}
                  onStopInline={handleStopInline}
                  onCaptureSuggestedVideo={(s) => handleCaptureSuggestedVideo(s, false)}
                  onSelectVideo={handleSelectVideo}
                  onMoveVideo={handleMoveVideo}
                  onPlayNext={handlePlayNext}
                  onToggleLike={handleToggleLike}
                  onDeleteVideo={handleDeleteVideo}
                  layout="sidebar"
                />
              </aside>
            )}
          </div>
        )}
      </main>

      {/* Persistent Audio-Only Music Mini Bar when browsing outside Music tab */}
      {showMusicMiniBar && (
        <MusicMiniBar
          controller={musicController}
          isOnline={isOnline}
          onOpenMusic={() => {
            setTopSearchOpen(false);
            setActiveView('music');
          }}
        />
      )}

      {/* Desktop Bottom-Left Dock: 'Reels' + 'Music' (no '+' Add button) */}
      <div className="hidden md:flex fixed bottom-5 left-6 z-40 items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setTopSearchOpen(false);
            setActiveView('reels');
          }}
          aria-label="Open Reels Shorts Feed"
          title="Endless vertical Reels feed"
          className={`min-h-[48px] px-4 rounded-2xl border text-xs font-semibold inline-flex items-center gap-2 shadow-xl transition-all active:scale-95 cursor-pointer ${
            !topSearchOpen && activeView === 'reels'
              ? 'bg-rose-600 text-white border-transparent shadow-rose-600/25'
              : 'bg-white/95 dark:bg-[#13161D]/95 backdrop-blur-md border-slate-200 dark:border-[#242A38] text-slate-800 dark:text-white hover:border-rose-500/60'
          }`}
        >
          <Clapperboard
            className={`w-4 h-4 ${
              !topSearchOpen && activeView === 'reels' ? 'text-white' : 'text-rose-500'
            }`}
          />
          <span>Reels</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setTopSearchOpen(false);
            setActiveView('music');
          }}
          aria-label="Open Music Audio Mode"
          title="Listen to any video as instant audio-only music"
          className={`min-h-[48px] px-4 rounded-2xl border text-xs font-semibold inline-flex items-center gap-2 shadow-xl transition-all active:scale-95 cursor-pointer ${
            !topSearchOpen && activeView === 'music'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent'
              : 'bg-white/95 dark:bg-[#13161D]/95 backdrop-blur-md border-slate-200 dark:border-[#242A38] text-slate-800 dark:text-white hover:border-rose-500/60'
          }`}
        >
          <Headphones className="w-4 h-4 text-rose-500" />
          <span>Music</span>
        </button>
      </div>

      {/* Mobile Bottom Navigation Bar: Home | Music | Reels | Discover | Library */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-14 pb-safe border-t border-slate-200 dark:border-[#1E2430] bg-white/95 dark:bg-[#0B0D11]/95 backdrop-blur-md grid grid-cols-5 items-center">
        {[
          {id: 'home' as AppView, label: 'Home', icon: Home},
          {id: 'music' as AppView, label: 'Music', icon: Headphones},
        ].map((tab) => {
          const Icon = tab.icon;
          const active = !topSearchOpen && activeView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setTopSearchOpen(false);
                setActiveView(tab.id);
              }}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                active
                  ? 'text-rose-600 dark:text-rose-500'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium tracking-tight">{tab.label}</span>
            </button>
          );
        })}

        {/* Center Reels Feed Trigger */}
        <button
          type="button"
          onClick={() => {
            setTopSearchOpen(false);
            setActiveView('reels');
          }}
          aria-label="Open endless Reels feed"
          className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            !topSearchOpen && activeView === 'reels'
              ? 'text-rose-600 dark:text-rose-500'
              : 'text-slate-600 dark:text-slate-300'
          }`}
        >
          <Clapperboard className="w-5 h-5" />
          <span className="text-[10px] font-semibold tracking-tight">Reels</span>
        </button>

        {[
          {id: 'discover' as AppView, label: 'Discover', icon: Search},
          {id: 'storage' as AppView, label: 'Library', icon: Database},
        ].map((tab) => {
          const Icon = tab.icon;
          const active = !topSearchOpen && activeView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setTopSearchOpen(false);
                setActiveView(tab.id);
              }}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                active
                  ? 'text-rose-600 dark:text-rose-500'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Passive Connectivity Notice when genuinely disconnected */}
      {!isOnline && (
        <div className="fixed bottom-16 md:bottom-20 left-4 md:left-6 z-30 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>Internet Disconnected</span>
        </div>
      )}

      {/* Unified Bottom '+' Quick Add Hub Modal */}
      {showQuickAddHub && (
        <Suspense fallback={null}>
          <QuickAddHubModal
            existingVideoIds={existingVideoIds}
            collections={collections}
            isOnline={isOnline}
            onAddedLinks={(items) => handleAddedVideos(items, false)}
            onImportedLibrary={async () => {
              await refreshLibrary();
              await refreshStats();
            }}
            onOpenDiscover={(q) => {
              setDiscoverInitialQuery(q);
              setActiveView('discover');
            }}
            onClose={() => setShowQuickAddHub(false)}
          />
        </Suspense>
      )}

      {/* Top Nav 'Suggestion' Drawer Modal showing ALL auto-fetched URLs */}
      {showSuggestionsModal && (
        <Suspense fallback={null}>
          <SuggestionsDrawerModal
            sourceVideo={suggestionSource}
            suggestions={autoSuggestions}
            loading={autoSuggestionsLoading}
            isOnline={isOnline}
            existingVideoIds={existingVideoIds}
            autoHarvestToHome={autoHarvestToHome}
            onToggleAutoHarvest={toggleAutoHarvest}
            onPlaySuggestion={(suggested) => handleCaptureSuggestedVideo(suggested, true)}
            onSaveAll={handleSaveAllSuggested}
            onClose={() => setShowSuggestionsModal(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
