import React, {useMemo, useState} from 'react';
import {
  CheckCircle2,
  FolderPlus,
  Link2,
  ListVideo,
  Loader2,
  Plus,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import {extractYouTubeInputs} from '../lib/youtube';
import {saveThumbnailBlob, saveVideosBulk} from '../lib/offlineDb';
import type {VideoChapter, VideoItem} from '../types/video';

interface AddLinksPanelProps {
  existingVideoIds: Set<string>;
  collections: string[];
  isOnline: boolean;
  onAdded: (items: VideoItem[]) => void;
  onClose?: () => void;
  onOpenDiscover?: () => void;
  isModal?: boolean;
  embedded?: boolean;
}

const QUICK_STARTER_LINKS = [
  'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  'https://www.youtube.com/watch?v=YE7VzlLtp-4',
  'https://youtube.com/playlist?list=RDCgoQXfZM-8U&playnext=1&si=aNXPbUzvSSrawYNp',
].join('\n');

interface ResolvedCandidate {
  videoId: string;
  originalUrl: string;
  title?: string;
  authorName?: string;
  authorUrl?: string;
  durationSeconds?: number | null;
}

export const AddLinksPanel: React.FC<AddLinksPanelProps> = ({
  existingVideoIds,
  collections,
  isOnline,
  onAdded,
  onClose,
  onOpenDiscover,
  isModal = false,
  embedded = false,
}) => {
  const [rawInput, setRawInput] = useState('');
  const [selectedCollection, setSelectedCollection] = useState(collections[0] || 'Watch Later');
  const [customCollection, setCustomCollection] = useState('');
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{label: string; done: number; total: number} | null>(
    null
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const parsed = useMemo(() => extractYouTubeInputs(rawInput), [rawInput]);
  const newDirectVideos = useMemo(
    () => parsed.videos.filter((l) => !existingVideoIds.has(l.videoId)),
    [parsed.videos, existingVideoIds]
  );
  const hasAnyInput =
    newDirectVideos.length > 0 || parsed.playlists.length > 0 || parsed.channels.length > 0;
  const duplicateDirectCount = parsed.videos.length - newDirectVideos.length;

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!hasAnyInput || isProcessing) return;

    const targetCollection =
      showNewCollection && customCollection.trim()
        ? customCollection.trim()
        : selectedCollection;

    setIsProcessing(true);
    setStatusMessage(null);
    setErrorMsg(null);

    const candidatesMap = new Map<string, ResolvedCandidate>();
    for (const v of newDirectVideos) {
      candidatesMap.set(v.videoId, {videoId: v.videoId, originalUrl: v.originalUrl});
    }

    if (isOnline && parsed.playlists.length > 0) {
      setProgress({label: 'Expanding playlists...', done: 0, total: parsed.playlists.length});
      for (let i = 0; i < parsed.playlists.length; i++) {
        const pl = parsed.playlists[i];
        try {
          const qs = new URLSearchParams({list: pl.listId});
          if (pl.seedVideoId) qs.set('v', pl.seedVideoId);
          const resp = await fetch(`/api/youtube/playlist?${qs.toString()}`);
          if (resp.ok) {
            const data = (await resp.json()) as {videos?: ResolvedCandidate[]};
            for (const pv of data.videos || []) {
              if (!existingVideoIds.has(pv.videoId) && !candidatesMap.has(pv.videoId)) {
                candidatesMap.set(pv.videoId, {
                  videoId: pv.videoId,
                  originalUrl: pv.originalUrl || `https://www.youtube.com/watch?v=${pv.videoId}`,
                  title: pv.title,
                  authorName: pv.authorName,
                  authorUrl: pv.authorUrl,
                  durationSeconds: pv.durationSeconds ?? null,
                });
              }
            }
          } else if (pl.seedVideoId && !existingVideoIds.has(pl.seedVideoId)) {
            candidatesMap.set(pl.seedVideoId, {
              videoId: pl.seedVideoId,
              originalUrl: pl.originalUrl,
            });
          }
        } catch {
          if (pl.seedVideoId && !existingVideoIds.has(pl.seedVideoId)) {
            candidatesMap.set(pl.seedVideoId, {
              videoId: pl.seedVideoId,
              originalUrl: pl.originalUrl,
            });
          }
        }
        setProgress({label: 'Expanding playlists...', done: i + 1, total: parsed.playlists.length});
      }
    } else if (!isOnline && parsed.playlists.length > 0) {
      for (const pl of parsed.playlists) {
        if (pl.seedVideoId && !existingVideoIds.has(pl.seedVideoId)) {
          candidatesMap.set(pl.seedVideoId, {
            videoId: pl.seedVideoId,
            originalUrl: pl.originalUrl,
          });
        }
      }
    }

    if (isOnline && parsed.channels.length > 0) {
      setProgress({label: 'Loading channel videos...', done: 0, total: parsed.channels.length});
      for (let i = 0; i < parsed.channels.length; i++) {
        const ch = parsed.channels[i];
        try {
          const resp = await fetch(
            `/api/youtube/channel?handle=${encodeURIComponent(ch.handle)}`
          );
          if (resp.ok) {
            const data = (await resp.json()) as {videos?: ResolvedCandidate[]};
            for (const cv of data.videos || []) {
              if (!existingVideoIds.has(cv.videoId) && !candidatesMap.has(cv.videoId)) {
                candidatesMap.set(cv.videoId, {
                  videoId: cv.videoId,
                  originalUrl: cv.originalUrl || `https://www.youtube.com/watch?v=${cv.videoId}`,
                  title: cv.title,
                  authorName: cv.authorName,
                  authorUrl: cv.authorUrl,
                  durationSeconds: cv.durationSeconds ?? null,
                });
              }
            }
          }
        } catch {
          // Ignore single channel fetch error
        }
        setProgress({label: 'Loading channel videos...', done: i + 1, total: parsed.channels.length});
      }
    }

    const candidates = Array.from(candidatesMap.values());
    if (candidates.length === 0) {
      setIsProcessing(false);
      setProgress(null);
      setErrorMsg('No new videos were found from those links (or they are already in your library).');
      return;
    }

    setProgress({label: 'Caching info & thumbnails', done: 0, total: candidates.length});
    const created: VideoItem[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      let title = item.title || `YouTube Video (${item.videoId})`;
      let authorName =
        item.authorName || (isOnline ? 'YouTube Creator' : 'Pending Sync (Added Offline)');
      let authorUrl = item.authorUrl || '';
      let description = '';
      let durationSeconds: number | null = item.durationSeconds ?? null;
      let chapters: VideoChapter[] | undefined = undefined;
      let thumbCached = false;

      if (isOnline && (!item.title || candidates.length <= 10)) {
        try {
          const metaResp = await fetch(
            `/api/youtube/metadata?videoId=${encodeURIComponent(item.videoId)}`
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
            if (!item.title && meta.title) title = meta.title;
            if (!item.authorName && meta.authorName) authorName = meta.authorName;
            if (!item.authorUrl && meta.authorUrl) authorUrl = meta.authorUrl;
            if (meta.description) description = meta.description;
            if (!durationSeconds && meta.durationSeconds) durationSeconds = meta.durationSeconds;
            if (Array.isArray(meta.chapters)) chapters = meta.chapters;
          }
        } catch {
          // Safe fallback
        }
      }

      if (isOnline) {
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
      }

      created.push({
        id: `${item.videoId}-${Date.now()}-${i}`,
        videoId: item.videoId,
        originalUrl: item.originalUrl,
        title,
        authorName,
        authorUrl,
        description,
        durationSeconds,
        collection: targetCollection,
        addedAt: Date.now() + (candidates.length - i),
        lastWatchedAt: null,
        lastPositionSeconds: 0,
        playbackRate: 1,
        bookmarks: [],
        chapters,
        notes: '',
        thumbCached,
      });

      setProgress({
        label: 'Caching info & thumbnails',
        done: i + 1,
        total: candidates.length,
      });
    }

    await saveVideosBulk(created);
    onAdded(created);
    setRawInput('');
    setIsProcessing(false);
    setProgress(null);
    setStatusMessage(`Added ${created.length} video${created.length > 1 ? 's' : ''} (thumbnails cached).`);
    if (onClose) {
      setTimeout(() => onClose(), 350);
    }
  }

  return (
    <div
      className={
        embedded
          ? 'w-full'
          : isModal
            ? 'w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-6 shadow-2xl'
            : 'w-full rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-6'
      }
    >
      {!embedded && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              Add YouTube Links, Playlists &amp; @Usernames
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Paste video URLs, playlist/mix links (<span className="font-mono">?list=...</span>), or channel <span className="font-mono">@usernames</span>. Thumbnails and chapters cache automatically.
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close add links panel"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1C212C] hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleIngest} className="mt-5 space-y-4">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <label
              htmlFor="youtube-links-input"
              className="text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              YouTube URLs, Playlists, or @Usernames
            </label>
            <div className="flex items-center gap-3">
              {onOpenDiscover && (
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    onOpenDiscover();
                  }}
                  className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                >
                  Browse @Username Search &rarr;
                </button>
              )}
              <button
                type="button"
                onClick={() => setRawInput(QUICK_STARTER_LINKS)}
                className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Sample links &amp; playlist</span>
              </button>
            </div>
          </div>

          <textarea
            id="youtube-links-input"
            rows={5}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder={
              'https://www.youtube.com/watch?v=...\nhttps://youtube.com/playlist?list=RDCgoQXfZM-8U&playnext=1&si=...\n@Fireship'
            }
            className="w-full rounded-xl border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] px-4 py-3 font-mono text-xs leading-relaxed text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-600/50 focus:border-rose-600"
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
              <span className="inline-flex items-center gap-1">
                <Link2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{newDirectVideos.length} videos</span>
              </span>
              {parsed.playlists.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
                    <ListVideo className="w-3.5 h-3.5" />
                    <span>{parsed.playlists.length} playlist(s) (auto-expands)</span>
                  </span>
                </>
              )}
              {parsed.channels.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
                    <User className="w-3.5 h-3.5" />
                    <span>{parsed.channels.length} channel(s) (loads all)</span>
                  </span>
                </>
              )}
              {duplicateDirectCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-600 dark:text-amber-400">
                    {duplicateDirectCount} already in library
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-1">
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Save to Collection
            </label>
            <div className="flex items-center gap-2">
              {showNewCollection ? (
                <input
                  type="text"
                  value={customCollection}
                  onChange={(e) => setCustomCollection(e.target.value)}
                  placeholder="Collection name (e.g. Music Mix)"
                  className="flex-1 min-h-[42px] rounded-lg border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] px-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-600/50"
                />
              ) : (
                <select
                  value={selectedCollection}
                  onChange={(e) => setSelectedCollection(e.target.value)}
                  className="flex-1 min-h-[42px] rounded-lg border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] px-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-600/50"
                >
                  {collections.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => setShowNewCollection((v) => !v)}
                className="min-h-[42px] px-3 rounded-lg border border-slate-200 dark:border-[#242A38] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1C212C] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>{showNewCollection ? 'Existing' : 'New Folder'}</span>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={!hasAnyInput || isProcessing}
            className="min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="font-mono tabular-nums">
                  {progress ? `${progress.done}/${progress.total}` : 'Working...'}
                </span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Add &amp; Cache Thumb</span>
              </>
            )}
          </button>
        </div>

        {errorMsg && <p className="text-xs text-rose-600 dark:text-rose-400">{errorMsg}</p>}

        {statusMessage && (
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
      </form>
    </div>
  );
};
