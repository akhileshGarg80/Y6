import React, {useEffect, useState} from 'react';
import {
  Check,
  CheckCircle2,
  Compass,
  ListVideo,
  Loader2,
  Play,
  Plus,
  Search,
  UserCheck,
  Users,
  WifiOff,
} from 'lucide-react';
import {saveThumbnailBlob, saveVideosBulk} from '../lib/offlineDb';
import type {VideoChapter, VideoItem} from '../types/video';
import {CachedThumbnail} from './CachedThumbnail';
import {InlineCardPlayer} from './InlineCardPlayer';

interface DiscoveredVideo {
  videoId: string;
  title: string;
  authorName: string;
  authorUrl: string;
  durationText: string;
  durationSeconds: number | null;
  viewText: string;
  watchUrl: string;
}

interface DiscoveredChannel {
  channelId: string;
  title: string;
  handle: string;
  subscriberText: string;
}

interface DiscoveredPlaylist {
  listId: string;
  title: string;
  authorName: string;
  videoCountText: string;
  playlistUrl: string;
}

interface DiscoverSearchViewProps {
  existingVideoIds: Set<string>;
  collections: string[];
  isOnline: boolean;
  activeInlineKey: string | null;
  onPlayInline: (key: string) => void;
  onStopInline: () => void;
  initialQuery?: string;
  onAdded: (items: VideoItem[], stayInPlace?: boolean) => void;
  onPlayExisting?: (videoId: string) => void;
}

const QUICK_EXPLORE_TOPICS: Array<{label: string; query: string; mode: 'channel-only' | 'advanced'}> = [
  {label: 'Lofi Hip Hop Beats', query: 'lofi hip hop radio beats', mode: 'advanced'},
  {label: '@Fireship', query: '@Fireship', mode: 'channel-only'},
  {label: '4K Nature & Scenic', query: '4K nature relaxation', mode: 'advanced'},
  {label: 'Acoustic & Indie Mix', query: 'acoustic chill sessions playlist', mode: 'advanced'},
  {label: 'Web Dev & AI Talks', query: 'React TypeScript conference talk', mode: 'advanced'},
];

export const DiscoverSearchView: React.FC<DiscoverSearchViewProps> = ({
  existingVideoIds,
  collections,
  isOnline,
  activeInlineKey,
  onPlayInline,
  onStopInline,
  initialQuery,
  onAdded,
  onPlayExisting,
}) => {
  const [query, setQuery] = useState(initialQuery || '');
  const [searchMode, setSearchMode] = useState<'channel-only' | 'advanced'>(
    initialQuery ? 'advanced' : 'channel-only'
  );
  const [advancedFilter, setAdvancedFilter] = useState<'all' | 'videos' | 'channels' | 'playlists'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeChannelInfo, setActiveChannelInfo] = useState<{
    title: string;
    handle: string;
    subscriberText?: string;
  } | null>(null);
  const [channels, setChannels] = useState<DiscoveredChannel[]>([]);
  const [playlists, setPlaylists] = useState<DiscoveredPlaylist[]>([]);
  const [results, setResults] = useState<DiscoveredVideo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetCollection, setTargetCollection] = useState(collections[0] || 'Watch Later');

  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{done: number; total: number} | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialQuery && initialQuery.trim() && isOnline) {
      setQuery(initialQuery);
      setSearchMode('advanced');
      runLookup(initialQuery, 'advanced', 'all');
    }
  }, [initialQuery]);

  async function runLookup(
    customQuery?: string,
    overrideMode?: 'channel-only' | 'advanced',
    overrideFilter?: 'all' | 'videos' | 'channels' | 'playlists'
  ) {
    const trimmed = (customQuery ?? query).trim();
    const mode = overrideMode ?? searchMode;
    const filter = overrideFilter ?? advancedFilter;
    if (!trimmed || !isOnline || loading) return;

    setLoading(true);
    setError(null);
    setStatusMessage(null);
    setSelectedIds(new Set());
    setActiveChannelInfo(null);

    try {
      if (mode === 'channel-only') {
        const resp = await fetch(
          `/api/youtube/channel?handle=${encodeURIComponent(trimmed)}`
        );
        const data = (await resp.json()) as {
          channelTitle?: string;
          handle?: string;
          subscriberText?: string;
          videos?: DiscoveredVideo[];
          matchingChannels?: DiscoveredChannel[];
          error?: string;
        };
        if (!resp.ok || !data.videos?.length) {
          throw new Error(data.error || 'No matching YouTube channel found');
        }
        setChannels(data.matchingChannels || []);
        setPlaylists([]);
        setActiveChannelInfo({
          title: data.channelTitle || trimmed,
          handle: data.handle || trimmed,
          subscriberText: data.subscriberText,
        });
        setResults(data.videos);
      } else {
        const resp = await fetch(
          `/api/youtube/search?q=${encodeURIComponent(trimmed)}&filter=${filter}`
        );
        const data = (await resp.json()) as {
          channels?: DiscoveredChannel[];
          playlists?: DiscoveredPlaylist[];
          videos?: DiscoveredVideo[];
          error?: string;
        };
        if (!resp.ok) {
          throw new Error(data.error || 'Search failed');
        }
        setChannels(data.channels || []);
        setPlaylists(data.playlists || []);
        setResults(data.videos || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load YouTube results');
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadChannel(handle: string, title: string, subscriberText?: string) {
    if (!isOnline || loading) return;
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    setSelectedIds(new Set());

    try {
      const resp = await fetch(`/api/youtube/channel?handle=${encodeURIComponent(handle)}`);
      const data = (await resp.json()) as {
        channelTitle?: string;
        handle?: string;
        subscriberText?: string;
        videos?: DiscoveredVideo[];
        matchingChannels?: DiscoveredChannel[];
        error?: string;
      };
      if (!resp.ok || !data.videos?.length) {
        throw new Error(data.error || 'Could not load channel videos');
      }
      setActiveChannelInfo({
        title: data.channelTitle || title,
        handle: data.handle || handle,
        subscriberText: data.subscriberText || subscriberText,
      });
      setPlaylists([]);
      setResults(data.videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Channel lookup failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleExpandPlaylist(listId: string, title: string) {
    if (!isOnline || loading) return;
    setLoading(true);
    setError(null);
    setStatusMessage(null);
    setSelectedIds(new Set());

    try {
      const resp = await fetch(`/api/youtube/playlist?list=${encodeURIComponent(listId)}`);
      const data = (await resp.json()) as {
        playlistTitle?: string;
        videos?: DiscoveredVideo[];
        error?: string;
      };
      if (!resp.ok || !data.videos?.length) {
        throw new Error(data.error || 'Could not load playlist videos');
      }
      setActiveChannelInfo({
        title: data.playlistTitle || title,
        handle: `Playlist · ${listId}`,
      });
      setResults(data.videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Playlist expansion failed');
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(videoId: string) {
    if (existingVideoIds.has(videoId)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }

  function selectAllAvailable() {
    const available = results
      .filter((r) => !existingVideoIds.has(r.videoId))
      .map((r) => r.videoId);
    if (selectedIds.size === available.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(available));
    }
  }

  async function importVideos(videosToImport: DiscoveredVideo[], stayInPlace = false) {
    const fresh = videosToImport.filter((v) => !existingVideoIds.has(v.videoId));
    if (fresh.length === 0 || importing) return;

    setImporting(true);
    setStatusMessage(null);
    setImportProgress({done: 0, total: fresh.length});

    const created: VideoItem[] = [];
    for (let i = 0; i < fresh.length; i++) {
      const item = fresh[i];
      let thumbCached = false;
      let chapters: VideoChapter[] | undefined = undefined;
      let description = '';

      if (fresh.length <= 5) {
        try {
          const metaResp = await fetch(
            `/api/youtube/metadata?videoId=${encodeURIComponent(item.videoId)}`
          );
          if (metaResp.ok) {
            const meta = (await metaResp.json()) as {
              description?: string;
              chapters?: VideoChapter[];
            };
            if (meta.description) description = meta.description;
            if (Array.isArray(meta.chapters)) chapters = meta.chapters;
          }
        } catch {
          // Safe fallback
        }
      }

      try {
        const thumbResp = await fetch(
          `/api/youtube/thumbnail?videoId=${encodeURIComponent(item.videoId)}`
        );
        if (thumbResp.ok) {
          const blob = await thumbResp.blob();
          await saveThumbnailBlob(item.videoId, blob);
          thumbCached = true;
        }
      } catch {
        // Safe fallback
      }

      created.push({
        id: `${item.videoId}-${Date.now()}-${i}`,
        videoId: item.videoId,
        originalUrl: item.watchUrl,
        title: item.title,
        authorName: item.authorName || activeChannelInfo?.title || 'YouTube Creator',
        authorUrl: item.authorUrl || '',
        description,
        durationSeconds: item.durationSeconds,
        collection: targetCollection,
        addedAt: Date.now() + (fresh.length - i),
        lastWatchedAt: null,
        lastPositionSeconds: 0,
        playbackRate: 1,
        bookmarks: [],
        chapters,
        notes: '',
        thumbCached,
      });

      setImportProgress({done: i + 1, total: fresh.length});
    }

    await saveVideosBulk(created);
    onAdded(created, stayInPlace);
    setSelectedIds(new Set());
    setImporting(false);
    setImportProgress(null);
    setStatusMessage(`Added ${created.length} video${created.length > 1 ? 's' : ''} to queue (thumbnails cached).`);
  }

  const availableCount = results.filter((r) => !existingVideoIds.has(r.videoId)).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Discover Channels &amp; Search YouTube
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Use <strong className="text-slate-700 dark:text-slate-200">Channel Only</strong> for exact <span className="font-mono">@username</span> browsing without algorithm noise, or <strong className="text-slate-700 dark:text-slate-200">Advanced Search</strong> across all videos and playlists.
        </p>
      </div>

      {!isOnline && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>You are currently offline. Reconnect to search YouTube channels and videos.</span>
        </div>
      )}

      {/* Search Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runLookup();
        }}
        className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0D11] border border-slate-200 dark:border-[#242A38]">
            <button
              type="button"
              onClick={() => setSearchMode('channel-only')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                searchMode === 'channel-only'
                  ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Channel / @Username Only
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('advanced')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                searchMode === 'advanced'
                  ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Advanced Search (All)
            </button>
          </div>

          {searchMode === 'advanced' && (
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0D11] border border-slate-200 dark:border-[#242A38]">
              {[
                {id: 'all', label: 'All'},
                {id: 'videos', label: 'Videos'},
                {id: 'channels', label: 'Channels'},
                {id: 'playlists', label: 'Playlists'},
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    const nextF = f.id as typeof advancedFilter;
                    setAdvancedFilter(nextF);
                    if (query.trim()) {
                      runLookup(query, 'advanced', nextF);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    advancedFilter === f.id
                      ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!isOnline}
              placeholder={
                searchMode === 'channel-only'
                  ? 'Enter channel name or @username (e.g. Code With Harry, @Fireship)...'
                  : 'Search any topic, song, lecture, movie, channel, or playlist...'
              }
              className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] pl-10 pr-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-600/50 disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={!isOnline || !query.trim() || loading}
            className="min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                <span>{searchMode === 'channel-only' ? 'Open Channel' : 'Search YouTube'}</span>
              </>
            )}
          </button>
        </div>

        {/* One-tap quick explore shortcuts when no results are open yet */}
        {results.length === 0 && channels.length === 0 && playlists.length === 0 && isOnline && (
          <div className="pt-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">
              <Compass className="w-3.5 h-3.5 text-rose-500" />
              <span>Quick Explore:</span>
            </span>
            {QUICK_EXPLORE_TOPICS.map((topic) => (
              <button
                key={topic.label}
                type="button"
                onClick={() => {
                  setQuery(topic.query);
                  setSearchMode(topic.mode);
                  runLookup(topic.query, topic.mode, 'all');
                }}
                className="min-h-[32px] px-3 rounded-lg border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] hover:border-rose-500/60 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
              >
                {topic.label}
              </button>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </form>

      {/* Matching Channels */}
      {channels.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-rose-500" />
            <span>
              {searchMode === 'channel-only' ? 'Matching Channels (Select One)' : 'Channels'}
            </span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {channels.map((ch) => {
              const isCurrent = activeChannelInfo?.handle === ch.handle;
              return (
                <button
                  key={ch.channelId}
                  type="button"
                  onClick={() => handleLoadChannel(ch.handle, ch.title, ch.subscriberText)}
                  className={`text-left rounded-xl border p-4 transition-colors cursor-pointer bg-white dark:bg-[#13161D] ${
                    isCurrent
                      ? 'border-rose-600 bg-rose-600/[0.05]'
                      : 'border-slate-200 dark:border-[#1E2430] hover:border-rose-500/60'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {ch.title}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono truncate">{ch.handle}</span>
                    {ch.subscriberText && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{ch.subscriberText}</span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Matching Playlists */}
      {playlists.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <ListVideo className="w-4 h-4 text-rose-500" />
            <span>Playlists (Click to Expand All Videos)</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {playlists.map((pl) => (
              <button
                key={pl.listId}
                type="button"
                onClick={() => handleExpandPlaylist(pl.listId, pl.title)}
                className="text-left rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] hover:border-rose-500/60 p-4 transition-colors cursor-pointer"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-2">
                  {pl.title}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="truncate">{pl.authorName}</span>
                  {pl.videoCountText && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{pl.videoCountText}</span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Video Results & Bulk Add Toolbar */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-900 dark:text-white">
                {activeChannelInfo ? activeChannelInfo.title : 'Search Results'}
              </span>
              {activeChannelInfo?.subscriberText && (
                <>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {activeChannelInfo.subscriberText}
                  </span>
                </>
              )}
              <span aria-hidden="true" className="text-slate-400">·</span>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {results.length} videos
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Target collection"
                value={targetCollection}
                onChange={(e) => setTargetCollection(e.target.value)}
                className="min-h-[38px] rounded-lg border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] px-2.5 text-xs text-slate-800 dark:text-slate-200"
              >
                {collections.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={selectAllAvailable}
                disabled={availableCount === 0}
                className="min-h-[38px] px-3 rounded-lg border border-slate-200 dark:border-[#242A38] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] disabled:opacity-40 cursor-pointer"
              >
                {selectedIds.size === availableCount && availableCount > 0
                  ? 'Deselect All'
                  : `Select All (${availableCount})`}
              </button>

              <button
                type="button"
                onClick={() => {
                  const chosen =
                    selectedIds.size > 0
                      ? results.filter((r) => selectedIds.has(r.videoId))
                      : results;
                  importVideos(chosen);
                }}
                disabled={availableCount === 0 || importing}
                className="min-h-[38px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="font-mono tabular-nums">
                      Adding {importProgress?.done ?? 0}/{importProgress?.total ?? 0}
                    </span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>
                      {selectedIds.size > 0
                        ? `Add Selected (${selectedIds.size})`
                        : `Add All (${availableCount})`}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

          {statusMessage && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((item) => {
              const inlineKey = `discover:${item.videoId}`;
              const alreadyAdded = existingVideoIds.has(item.videoId);
              const isSelected = selectedIds.has(item.videoId);
              const isInlinePlaying = activeInlineKey === inlineKey;
              return (
                <div
                  key={item.videoId}
                  className={`rounded-2xl border overflow-hidden transition-colors bg-white dark:bg-[#13161D] ${
                    isInlinePlaying || isSelected
                      ? 'border-rose-600'
                      : 'border-slate-200 dark:border-[#1E2430]'
                  }`}
                >
                  <div className="relative aspect-video bg-black overflow-hidden">
                    {isInlinePlaying ? (
                      <InlineCardPlayer
                        videoId={item.videoId}
                        title={item.title}
                        isOnline={isOnline}
                        onStop={onStopInline}
                        onPlayStarted={() => onPlayInline(inlineKey)}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onPlayInline(inlineKey)}
                          aria-label={`Preview ${item.title} inline`}
                          className="relative w-full h-full block cursor-pointer group"
                        >
                          <CachedThumbnail
                            videoId={item.videoId}
                            alt={item.title}
                            isOnline={isOnline}
                            fit="contain"
                            className="w-full h-full group-hover:scale-[1.02] transition-transform duration-200"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                          {item.durationText && (
                            <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white tabular-nums">
                              {item.durationText}
                            </span>
                          )}
                          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
                            <Play className="w-3 h-3 fill-current text-rose-500" />
                            <span>Play Here</span>
                          </span>
                        </button>

                        {!alreadyAdded && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(item.videoId);
                            }}
                            aria-label={`Select ${item.title}`}
                            className={`absolute top-2.5 left-2.5 w-6 h-6 rounded-md border flex items-center justify-center transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-rose-600 border-rose-600 text-white'
                                : 'bg-black/60 border-white/40 text-transparent hover:border-white'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  <div className="p-4 space-y-2.5">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-2 leading-snug">
                      {item.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="truncate max-w-[140px]">{item.authorName}</span>
                      {item.viewText && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{item.viewText}</span>
                        </>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-[#1E2430] flex items-center justify-between gap-2">
                      {alreadyAdded ? (
                        <div className="flex items-center justify-between w-full gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>In Library</span>
                          </span>
                          {onPlayExisting && (
                            <button
                              type="button"
                              onClick={() => onPlayExisting(item.videoId)}
                              className="min-h-[34px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>Open</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => importVideos([item], true)}
                          disabled={importing}
                          className="min-h-[36px] px-3 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add to Library</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
