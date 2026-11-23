import React, {useEffect, useMemo, useState} from 'react';
import {
  ArrowLeft,
  Check,
  Headphones,
  Heart,
  ListVideo,
  Loader2,
  Play,
  Plus,
  Search,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import type {SuggestedVideoInput, VideoItem} from '../types/video';
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

interface TopSearchResultsViewProps {
  query: string;
  searchNonce: number;
  videos: VideoItem[];
  existingVideoIds: Set<string>;
  isOnline: boolean;
  activeInlineKey: string | null;
  onPlayInline: (key: string, titleHint?: string) => void;
  onStopInline: () => void;
  onCaptureSuggestedVideo: (suggested: SuggestedVideoInput, playInStage?: boolean) => void;
  onSaveAndLikeVideo: (suggested: SuggestedVideoInput) => void;
  onPlayInMusic: (suggested: SuggestedVideoInput) => void;
  onSelectSavedVideo: (id: string) => void;
  onToggleLikeSaved: (video: VideoItem) => void;
  onClose: () => void;
}

export const TopSearchResultsView: React.FC<TopSearchResultsViewProps> = ({
  query,
  searchNonce,
  videos,
  existingVideoIds,
  isOnline,
  activeInlineKey,
  onPlayInline,
  onStopInline,
  onCaptureSuggestedVideo,
  onSaveAndLikeVideo,
  onPlayInMusic,
  onSelectSavedVideo,
  onToggleLikeSaved,
  onClose,
}) => {
  const [filter, setFilter] = useState<'all' | 'videos' | 'channels' | 'playlists'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DiscoveredVideo[]>([]);
  const [channels, setChannels] = useState<DiscoveredChannel[]>([]);
  const [playlists, setPlaylists] = useState<DiscoveredPlaylist[]>([]);
  const [drillHeader, setDrillHeader] = useState<{title: string; subtitle?: string} | null>(null);

  const savedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return videos
      .filter((v) => `${v.title} ${v.authorName} ${v.collection}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [videos, query]);

  const savedByYtId = useMemo(() => {
    const map = new Map<string, VideoItem>();
    for (const v of videos) {
      map.set(v.videoId, v);
    }
    return map;
  }, [videos]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !isOnline) {
      setResults([]);
      setChannels([]);
      setPlaylists([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDrillHeader(null);

    fetch(
      `/api/youtube/search?q=${encodeURIComponent(trimmed)}&filter=${filter}`,
      {signal: controller.signal}
    )
      .then(async (resp) => {
        const data = (await resp.json()) as {
          channels?: DiscoveredChannel[];
          playlists?: DiscoveredPlaylist[];
          videos?: DiscoveredVideo[];
          error?: string;
        };
        if (!resp.ok) {
          throw new Error(data.error || 'YouTube search failed');
        }
        setChannels(data.channels || []);
        setPlaylists(data.playlists || []);
        setResults(data.videos || []);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load YouTube results');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [query, filter, searchNonce, isOnline]);

  async function handleOpenChannel(handle: string, title: string, subscriberText?: string) {
    if (!isOnline || loading) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/youtube/channel?handle=${encodeURIComponent(handle)}`);
      const data = (await resp.json()) as {
        channelTitle?: string;
        subscriberText?: string;
        videos?: DiscoveredVideo[];
        error?: string;
      };
      if (!resp.ok || !data.videos?.length) {
        throw new Error(data.error || 'Could not load channel videos');
      }
      setDrillHeader({
        title: data.channelTitle || title,
        subtitle: data.subscriberText || subscriberText || handle,
      });
      setResults(data.videos);
      setPlaylists([]);
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
      setDrillHeader({
        title: data.playlistTitle || title,
        subtitle: `${data.videos.length} videos in playlist`,
      });
      setResults(data.videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Playlist lookup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Direct Top-Bar Search Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to feed"
            className="min-h-[36px] px-3 rounded-xl border border-slate-200 dark:border-[#242A38] hover:border-rose-500/60 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <span className="truncate">
                {drillHeader ? drillHeader.title : `YouTube Results: "${query.trim()}"`}
              </span>
            </div>
            {drillHeader?.subtitle && (
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {drillHeader.subtitle}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0B0D11] border border-slate-200 dark:border-[#242A38]">
            {[
              {id: 'all', label: 'All'},
              {id: 'videos', label: 'Videos'},
              {id: 'channels', label: 'Channels'},
              {id: 'playlists', label: 'Playlists'},
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id as typeof filter)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  filter === f.id
                    ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-800 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isOnline && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>Internet disconnected — showing matching videos from your saved library only.</span>
        </div>
      )}

      {/* Matching Saved Videos */}
      {savedMatches.length > 0 && (
        <div className="space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            In Your Saved Library ({savedMatches.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {savedMatches.map((m) => (
              <div
                key={m.id}
                className="rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-2.5 flex items-center gap-3 hover:border-rose-500/60 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSelectSavedVideo(m.id);
                  }}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer group"
                >
                  <div className="w-20 aspect-video rounded-lg overflow-hidden bg-black shrink-0 relative">
                    <CachedThumbnail
                      videoId={m.videoId}
                      alt={m.title}
                      isOnline={isOnline}
                      fit="cover"
                      className="w-full h-full"
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="w-4 h-4 text-white fill-current" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-2 group-hover:text-rose-500">
                      {m.title}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {m.authorName} · {m.collection}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onToggleLikeSaved(m)}
                  aria-label={m.liked ? 'Unlike' : 'Like'}
                  className={`p-2 rounded-lg shrink-0 cursor-pointer ${
                    m.liked ? 'text-rose-500 bg-rose-500/10' : 'text-slate-400 hover:text-rose-500'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${m.liked ? 'fill-current' : ''}`} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading / Error */}
      {loading && (
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-10 flex items-center justify-center gap-2.5 text-sm text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin text-rose-500" />
          <span>Searching YouTube...</span>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Channels */}
      {!loading && channels.length > 0 && !drillHeader && (
        <div className="space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-rose-500" />
            <span>Channels</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {channels.map((ch) => (
              <button
                key={ch.channelId}
                type="button"
                onClick={() => handleOpenChannel(ch.handle, ch.title, ch.subscriberText)}
                className="text-left rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] hover:border-rose-500/60 p-3.5 transition-colors cursor-pointer"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {ch.title}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                  {ch.handle}
                  {ch.subscriberText ? ` · ${ch.subscriberText}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Playlists */}
      {!loading && playlists.length > 0 && !drillHeader && (
        <div className="space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <ListVideo className="w-3.5 h-3.5 text-rose-500" />
            <span>Playlists</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {playlists.map((pl) => (
              <button
                key={pl.listId}
                type="button"
                onClick={() => handleExpandPlaylist(pl.listId, pl.title)}
                className="text-left rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] hover:border-rose-500/60 p-3.5 transition-colors cursor-pointer"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-2">
                  {pl.title}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                  {pl.authorName}
                  {pl.videoCountText ? ` · ${pl.videoCountText}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Live YouTube Videos */}
      {!loading && results.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            YouTube Videos ({results.length})
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {results.map((item) => {
              const inlineKey = `topsearch:${item.videoId}`;
              const isInlinePlaying = activeInlineKey === inlineKey;
              const savedItem = savedByYtId.get(item.videoId);
              const alreadyAdded = existingVideoIds.has(item.videoId);

              const payload: SuggestedVideoInput = {
                videoId: item.videoId,
                title: item.title,
                authorName: item.authorName,
                authorUrl: item.authorUrl,
                durationSeconds: item.durationSeconds,
              };

              return (
                <div
                  key={item.videoId}
                  className={`rounded-2xl border overflow-hidden transition-colors bg-white dark:bg-[#13161D] ${
                    isInlinePlaying
                      ? 'border-rose-600'
                      : 'border-slate-200 dark:border-[#1E2430] hover:border-slate-300 dark:hover:border-[#2C3446]'
                  }`}
                >
                  <div className="relative w-full aspect-video bg-black overflow-hidden">
                    {isInlinePlaying ? (
                      <InlineCardPlayer
                        videoId={item.videoId}
                        title={item.title}
                        isOnline={isOnline}
                        onStop={onStopInline}
                        onPlayStarted={() => onPlayInline(inlineKey, item.title)}
                        onCaptureSuggestedVideo={(s) => onCaptureSuggestedVideo(s, false)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPlayInline(inlineKey, item.title)}
                        aria-label={`Play ${item.title}`}
                        className="relative w-full h-full block cursor-pointer group text-left"
                      >
                        <CachedThumbnail
                          videoId={item.videoId}
                          alt={item.title}
                          isOnline={isOnline}
                          fit="cover"
                          className="w-full h-full group-hover:scale-[1.02] transition-transform duration-200"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="w-12 h-12 rounded-full bg-black/75 border border-white/20 text-white flex items-center justify-center opacity-90 group-hover:bg-rose-600 group-hover:border-rose-500 group-hover:scale-105 transition-all shadow-lg">
                            <Play className="w-5 h-5 fill-current ml-0.5" />
                          </span>
                        </span>
                        {item.durationText && (
                          <span className="absolute bottom-2 right-2 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white tabular-nums">
                            {item.durationText}
                          </span>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="p-4 space-y-3">
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onCaptureSuggestedVideo(payload, true);
                        }}
                        className="text-left w-full cursor-pointer"
                      >
                        <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white line-clamp-2 leading-snug hover:text-rose-500 transition-colors">
                          {item.title}
                        </h3>
                      </button>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <span className="truncate max-w-[180px]">{item.authorName}</span>
                        {item.viewText && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{item.viewText}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-slate-100 dark:border-[#1E2430] flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onCaptureSuggestedVideo(payload, true);
                          }}
                          className="min-h-[34px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Watch</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onPlayInMusic(payload)}
                          title="Play audio directly in Music Mode"
                          className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-[#242A38] hover:border-rose-500/60 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Headphones className="w-3.5 h-3.5 text-rose-500" />
                          <span>Music</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (savedItem) {
                              onToggleLikeSaved(savedItem);
                            } else {
                              onSaveAndLikeVideo(payload);
                            }
                          }}
                          title={savedItem?.liked ? 'Liked (Protected)' : 'Like & save video'}
                          className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 cursor-pointer ${
                            savedItem?.liked
                              ? 'border-rose-500/40 bg-rose-500/10 text-rose-500'
                              : 'border-slate-200 dark:border-[#242A38] text-slate-500 hover:text-rose-500'
                          }`}
                        >
                          <Heart className={`w-3.5 h-3.5 ${savedItem?.liked ? 'fill-current' : ''}`} />
                        </button>

                        {alreadyAdded ? (
                          <span className="min-h-[34px] px-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold inline-flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            <span>Saved</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onCaptureSuggestedVideo(payload, false)}
                            className="min-h-[34px] px-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Save</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && isOnline && !error && results.length === 0 && channels.length === 0 && playlists.length === 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-10 text-center text-sm text-slate-500">
          No YouTube results found for &ldquo;{query.trim()}&rdquo;. Try another keyword.
        </div>
      )}
    </div>
  );
};
