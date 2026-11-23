import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Heart,
  ListPlus,
  Play,
  Search,
  Trash2,
} from 'lucide-react';
import {formatDuration, formatRelativeDate} from '../lib/youtube';
import type {SuggestedVideoInput, VideoItem} from '../types/video';
import {CachedThumbnail} from './CachedThumbnail';
import {InlineCardPlayer} from './InlineCardPlayer';

interface VideoQueueListProps {
  videos: VideoItem[];
  activeVideoId: string | null;
  isOnline: boolean;
  collections: string[];
  activeInlineKey: string | null;
  keyPrefix: string;
  externalSearchQuery?: string;
  onPlayInline: (key: string) => void;
  onStopInline: () => void;
  onCaptureSuggestedVideo?: (suggested: SuggestedVideoInput) => void;
  onSelectVideo: (id: string) => void;
  onMoveVideo: (id: string, direction: 'up' | 'down') => void;
  onPlayNext?: (id: string) => void;
  onToggleLike?: (video: VideoItem) => void;
  onDeleteVideo: (video: VideoItem) => void;
  layout?: 'sidebar' | 'grid';
}

export const VideoQueueList: React.FC<VideoQueueListProps> = ({
  videos,
  activeVideoId,
  isOnline,
  collections,
  activeInlineKey,
  keyPrefix,
  externalSearchQuery = '',
  onPlayInline,
  onStopInline,
  onCaptureSuggestedVideo,
  onSelectVideo,
  onMoveVideo,
  onPlayNext,
  onToggleLike,
  onDeleteVideo,
  layout = 'sidebar',
}) => {
  const pageBatch = layout === 'grid' ? 24 : 30;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCollection, setActiveCollection] = useState('All');
  const [typeFilter, setTypeFilter] = useState<
    'all' | 'liked' | 'continue' | 'bookmarked' | 'chapters'
  >('all');
  const [sortBy, setSortBy] = useState<'queue' | 'recent' | 'duration' | 'title'>('queue');
  const [cardSize, setCardSize] = useState<'large' | 'cinema'>('large');
  const [visibleCount, setVisibleCount] = useState(pageBatch);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const effectiveSearch = (externalSearchQuery || searchQuery).trim().toLowerCase();

  const filtered = useMemo(() => {
    const list = videos.filter((v) => {
      if (activeCollection !== 'All' && v.collection !== activeCollection) return false;
      if (typeFilter === 'liked' && !v.liked) return false;
      if (typeFilter === 'continue' && !(v.lastPositionSeconds > 5)) return false;
      if (typeFilter === 'bookmarked' && v.bookmarks.length === 0) return false;
      if (typeFilter === 'chapters' && !(v.chapters && v.chapters.length > 0)) return false;

      if (effectiveSearch) {
        const hay = `${v.title} ${v.authorName} ${v.collection} ${v.notes}`.toLowerCase();
        if (!hay.includes(effectiveSearch)) return false;
      }
      return true;
    });

    if (sortBy === 'recent') {
      return [...list].sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0));
    }
    if (sortBy === 'duration') {
      return [...list].sort((a, b) => (b.durationSeconds || 0) - (a.durationSeconds || 0));
    }
    if (sortBy === 'title') {
      return [...list].sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [videos, effectiveSearch, activeCollection, typeFilter, sortBy]);

  useEffect(() => {
    setVisibleCount(pageBatch);
  }, [effectiveSearch, activeCollection, typeFilter, sortBy, pageBatch]);

  const visibleItems = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );

  const hasMore = visibleItems.length < filtered.length;

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!hasMore || !el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((prev) => Math.min(filtered.length, prev + pageBatch));
        }
      },
      {rootMargin: '400px'}
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, filtered.length, pageBatch]);

  function handleSelectTitle(id: string) {
    onStopInline();
    onSelectVideo(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {layout === 'sidebar' && !externalSearchQuery ? (
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter queue..."
              className="w-full min-h-[40px] rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] pl-10 pr-4 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-600/50"
            />
          </div>
        ) : (
          <div className="hidden md:block text-xs text-slate-500 dark:text-slate-400 font-mono">
            {effectiveSearch ? `Filtering by "${externalSearchQuery || searchQuery}"` : `${filtered.length} items`}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#13161D] border border-slate-200 dark:border-[#1E2430] overflow-x-auto max-w-full">
            {[
              {id: 'all', label: 'All'},
              {id: 'liked', label: 'Liked'},
              {id: 'continue', label: 'In Progress'},
              {id: 'bookmarked', label: 'Bookmarked'},
              {id: 'chapters', label: 'Chapters'},
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTypeFilter(tab.id as typeof typeFilter)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  typeFilter === tab.id
                    ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {layout === 'grid' && (
            <>
              <div className="hidden lg:flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#13161D] border border-slate-200 dark:border-[#1E2430]">
                <button
                  type="button"
                  onClick={() => setCardSize('large')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    cardSize === 'large'
                      ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  2-Col
                </button>
                <button
                  type="button"
                  onClick={() => setCardSize('cinema')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    cardSize === 'cinema'
                      ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Big 1-Col
                </button>
              </div>

              <select
                aria-label="Filter by collection"
                value={activeCollection}
                onChange={(e) => setActiveCollection(e.target.value)}
                className="min-h-[38px] rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] px-3 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                {['All', ...collections].map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>

              <select
                aria-label="Sort videos"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="min-h-[38px] rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] px-3 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <option value="queue">Sort: Queue Order</option>
                <option value="recent">Sort: Recently Watched</option>
                <option value="duration">Sort: Longest First</option>
                <option value="title">Sort: Title A-Z</option>
              </select>
            </>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-10 text-center">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            No matching videos found.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Switch filters or tap the + button at the bottom to add YouTube links or search channels.
          </p>
        </div>
      ) : layout === 'grid' ? (
        <div
          className={
            cardSize === 'cinema'
              ? 'grid grid-cols-1 max-w-5xl mx-auto gap-7'
              : 'grid grid-cols-1 lg:grid-cols-2 gap-6'
          }
        >
          {visibleItems.map((item) => {
            const inlineKey = `${keyPrefix}:${item.id}`;
            const isActive = item.id === activeVideoId;
            const isInlinePlaying = activeInlineKey === inlineKey;
            const watchPct =
              item.durationSeconds && item.durationSeconds > 0 && item.lastPositionSeconds > 0
                ? Math.min(100, Math.round((item.lastPositionSeconds / item.durationSeconds) * 100))
                : 0;

            return (
              <div
                key={item.id}
                className={`group rounded-2xl border overflow-hidden transition-colors bg-white dark:bg-[#13161D] flex flex-col ${
                  isInlinePlaying || isActive
                    ? 'border-rose-600'
                    : 'border-slate-200 dark:border-[#1E2430] hover:border-slate-300 dark:hover:border-[#2C3446]'
                }`}
              >
                {/* Edge-to-edge 16:9 Large Video Box — zero empty black bars */}
                <div className="relative w-full aspect-video bg-black overflow-hidden">
                  {isInlinePlaying ? (
                    <InlineCardPlayer
                      videoId={item.videoId}
                      title={item.title}
                      isOnline={isOnline}
                      onStop={onStopInline}
                      onPlayStarted={() => onPlayInline(inlineKey)}
                      onCaptureSuggestedVideo={onCaptureSuggestedVideo}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onPlayInline(inlineKey)}
                      aria-label={`Play ${item.title}`}
                      className="relative w-full h-full block cursor-pointer text-left"
                    >
                      <CachedThumbnail
                        videoId={item.videoId}
                        alt={item.title}
                        isOnline={isOnline}
                        fit="cover"
                        className="w-full h-full transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent opacity-80 group-hover:opacity-100 transition-opacity" />

                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="w-12 h-12 rounded-full bg-black/75 border border-white/20 text-white flex items-center justify-center opacity-90 group-hover:bg-rose-600 group-hover:border-rose-500 group-hover:scale-105 transition-all shadow-lg">
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        </span>
                      </span>

                      {item.durationSeconds && (
                        <span className="absolute bottom-2 right-2 rounded-md bg-black/85 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white tabular-nums">
                          {formatDuration(item.durationSeconds)}
                        </span>
                      )}

                      {watchPct > 0 && (
                        <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20">
                          <div className="h-full bg-rose-600" style={{width: `${watchPct}%`}} />
                        </div>
                      )}
                    </button>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => handleSelectTitle(item.id)}
                      className="text-left w-full cursor-pointer"
                    >
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white line-clamp-2 leading-snug hover:text-rose-600 dark:hover:text-rose-400 transition-colors">
                        {item.title}
                      </h3>
                    </button>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="truncate max-w-[160px]">{item.authorName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.collection}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatRelativeDate(item.addedAt)}</span>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 dark:border-[#1E2430] flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-mono text-[11px] truncate">
                      <span>{item.thumbCached ? 'Thumb Cached' : 'YouTube'}</span>
                      {item.bookmarks.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-0.5 text-amber-500">
                            <Bookmark className="w-3 h-3" />
                            <span>{item.bookmarks.length}</span>
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {onToggleLike && (
                        <button
                          type="button"
                          onClick={() => onToggleLike(item)}
                          title={item.liked ? 'Liked (protected from clear unliked)' : 'Like & protect video'}
                          aria-label={item.liked ? `Unlike ${item.title}` : `Like ${item.title}`}
                          className={`min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                            item.liked
                              ? 'text-rose-500 bg-rose-500/10'
                              : 'text-slate-400 hover:text-rose-500'
                          }`}
                        >
                          <Heart className={`w-3.5 h-3.5 ${item.liked ? 'fill-current' : ''}`} />
                        </button>
                      )}
                      {onPlayNext && !isActive && (
                        <button
                          type="button"
                          onClick={() => onPlayNext(item.id)}
                          title="Move to top of queue"
                          aria-label={`Move ${item.title} to top`}
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          <ListPlus className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteVideo(item)}
                        aria-label={`Delete ${item.title}`}
                        className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Sidebar Queue: expands card cleanly with taller player height when playing inline */
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] divide-y divide-slate-100 dark:divide-[#1E2430] overflow-hidden">
          {visibleItems.map((item, idx) => {
            const inlineKey = `${keyPrefix}:${item.id}`;
            const isActive = item.id === activeVideoId;
            const isInlinePlaying = activeInlineKey === inlineKey;
            const watchPct =
              item.durationSeconds && item.durationSeconds > 0 && item.lastPositionSeconds > 0
                ? Math.min(100, Math.round((item.lastPositionSeconds / item.durationSeconds) * 100))
                : 0;

            return (
              <div
                key={item.id}
                className={`p-3 transition-colors ${
                  isInlinePlaying ? 'space-y-2.5' : 'flex items-start gap-3'
                } ${
                  isInlinePlaying || isActive
                    ? 'bg-rose-600/[0.06] dark:bg-rose-500/[0.08]'
                    : 'hover:bg-slate-50 dark:hover:bg-[#171B24]'
                }`}
              >
                <div
                  className={`relative rounded-xl overflow-hidden bg-black shrink-0 transition-all ${
                    isInlinePlaying ? 'w-full aspect-video' : 'w-36 aspect-video'
                  }`}
                >
                  {isInlinePlaying ? (
                    <InlineCardPlayer
                      videoId={item.videoId}
                      title={item.title}
                      isOnline={isOnline}
                      compact
                      onStop={onStopInline}
                      onPlayStarted={() => onPlayInline(inlineKey)}
                      onCaptureSuggestedVideo={onCaptureSuggestedVideo}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onPlayInline(inlineKey)}
                      aria-label={`Play ${item.title} inline`}
                      className="relative w-full h-full block cursor-pointer group"
                    >
                      <CachedThumbnail
                        videoId={item.videoId}
                        alt={item.title}
                        isOnline={isOnline}
                        fit="cover"
                        className="w-full h-full"
                      />
                      <div className="absolute inset-0 bg-black/25 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                        <span className="w-7 h-7 rounded-full bg-black/75 text-white flex items-center justify-center opacity-85 group-hover:opacity-100 group-hover:bg-rose-600 transition-colors">
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </span>
                      </div>
                      {item.durationSeconds && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 font-mono text-[10px] text-white tabular-nums">
                          {formatDuration(item.durationSeconds)}
                        </span>
                      )}
                      {watchPct > 0 && (
                        <div className="absolute bottom-0 inset-x-0 h-0.5 bg-white/20">
                          <div className="h-full bg-rose-600" style={{width: `${watchPct}%`}} />
                        </div>
                      )}
                    </button>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => handleSelectTitle(item.id)}
                    className="text-left w-full cursor-pointer"
                  >
                    <h4
                      className={`text-xs font-semibold line-clamp-2 leading-snug hover:text-rose-600 dark:hover:text-rose-400 ${
                        isActive
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {item.title}
                    </h4>
                  </button>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="truncate max-w-[110px]">{item.authorName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.collection}</span>
                    {item.bookmarks.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-500 font-mono">{item.bookmarks.length} pins</span>
                      </>
                    )}
                  </div>

                  <div className="mt-1.5 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onMoveVideo(item.id, 'up')}
                      disabled={idx === 0 || sortBy !== 'queue'}
                      aria-label="Move up in queue"
                      className="p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveVideo(item.id, 'down')}
                      disabled={idx === filtered.length - 1 || sortBy !== 'queue'}
                      aria-label="Move down in queue"
                      className="p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    {onToggleLike && (
                      <button
                        type="button"
                        onClick={() => onToggleLike(item)}
                        title={item.liked ? 'Liked (protected)' : 'Like video'}
                        aria-label={item.liked ? `Unlike ${item.title}` : `Like ${item.title}`}
                        className={`p-1.5 rounded cursor-pointer ${
                          item.liked
                            ? 'text-rose-500'
                            : 'text-slate-400 hover:text-rose-500'
                        }`}
                      >
                        <Heart className={`w-3.5 h-3.5 ${item.liked ? 'fill-current' : ''}`} />
                      </button>
                    )}
                    {onPlayNext && !isActive && (
                      <button
                        type="button"
                        onClick={() => onPlayNext(item.id)}
                        title="Play Next"
                        aria-label={`Play ${item.title} next`}
                        className="p-1.5 rounded text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <ListPlus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteVideo(item)}
                      aria-label="Remove video"
                      className="p-1.5 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer ml-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div ref={loadMoreRef} className="pt-2 flex items-center justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => Math.min(filtered.length, prev + pageBatch))}
            className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-rose-500/60 transition-colors cursor-pointer"
          >
            Load more ({filtered.length - visibleItems.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
};
