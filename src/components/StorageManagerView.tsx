import React, {useMemo, useRef, useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  Database,
  Download,
  FolderEdit,
  HardDrive,
  Heart,
  Loader2,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  clearThumbnailCache,
  saveThumbnailBlob,
  saveVideosBulk,
} from '../lib/offlineDb';
import {formatBytes} from '../lib/youtube';
import type {StorageStats, VideoChapter, VideoItem} from '../types/video';
import {CachedThumbnail} from './CachedThumbnail';
import {PWAInstallButton} from './PWAInstallButton';

interface StorageManagerViewProps {
  stats: StorageStats;
  videos: VideoItem[];
  isOnline: boolean;
  darkMode: boolean;
  autoSuggestionsCount: number;
  autoSuggestionsLoading: boolean;
  externalSearchQuery?: string;
  onToggleTheme: () => void;
  onOpenSuggestions: () => void;
  onOpenAddHub?: () => void;
  onToggleLike: (video: VideoItem) => void;
  onSelectVideo: (id: string) => void;
  onDeleteSingleVideo: (video: VideoItem) => Promise<void> | void;
  onBulkDeleteVideos: (includeLiked: boolean) => Promise<number>;
  onRefreshLibrary: () => Promise<void>;
  onStatsChange: () => void;
}

export const StorageManagerView: React.FC<StorageManagerViewProps> = ({
  stats,
  videos,
  isOnline,
  darkMode,
  autoSuggestionsCount,
  autoSuggestionsLoading,
  externalSearchQuery = '',
  onToggleTheme,
  onOpenSuggestions,
  onOpenAddHub,
  onToggleLike,
  onSelectVideo,
  onDeleteSingleVideo,
  onBulkDeleteVideos,
  onRefreshLibrary,
  onStatsChange,
}) => {
  const importRef = useRef<HTMLInputElement | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editingCollection, setEditingCollection] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmMode, setConfirmMode] = useState<'none' | 'unliked' | 'all'>('none');
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [libSearch, setLibSearch] = useState('');
  const [libFilter, setLibFilter] = useState<'all' | 'liked' | 'unliked'>('all');
  const [confirmSingleLikedId, setConfirmSingleLikedId] = useState<string | null>(null);

  const likedCount = useMemo(() => videos.filter((v) => v.liked).length, [videos]);
  const unlikedCount = videos.length - likedCount;

  const totalBookmarks = useMemo(
    () => videos.reduce((acc, v) => acc + v.bookmarks.length, 0),
    [videos]
  );

  const totalNotesCount = useMemo(
    () => videos.filter((v) => v.notes.trim().length > 0).length,
    [videos]
  );

  const collectionBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of videos) {
      const col = v.collection || 'Watch Later';
      map.set(col, (map.get(col) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [videos]);

  const effectiveQuery = (externalSearchQuery || libSearch).trim().toLowerCase();

  const filteredVideos = useMemo(() => {
    return videos.filter((v) => {
      if (libFilter === 'liked' && !v.liked) return false;
      if (libFilter === 'unliked' && v.liked) return false;
      if (effectiveQuery) {
        const hay = `${v.title} ${v.authorName} ${v.collection} ${v.originalUrl}`.toLowerCase();
        if (!hay.includes(effectiveQuery)) return false;
      }
      return true;
    });
  }, [videos, libFilter, effectiveQuery]);

  async function handleBulkDeleteConfirm(includeLiked: boolean) {
    setDeletingBulk(true);
    setMessage(null);
    try {
      const removed = await onBulkDeleteVideos(includeLiked);
      setConfirmMode('none');
      if (includeLiked) {
        setMessage(`Removed all ${removed} videos & URLs from your library.`);
      } else {
        setMessage(
          `Removed ${removed} unliked videos. ${likedCount} liked video${likedCount === 1 ? '' : 's'} kept safe!`
        );
      }
    } finally {
      setDeletingBulk(false);
    }
  }

  async function handleSyncPending() {
    if (!isOnline || syncing) return;
    setSyncing(true);
    setMessage(null);
    let syncedCount = 0;

    const updated: VideoItem[] = [];
    for (const v of videos) {
      let next = {...v};
      const needsMeta =
        v.title.startsWith('YouTube Video (') ||
        v.authorName.includes('Pending Sync') ||
        v.chapters === undefined;

      if (needsMeta) {
        try {
          const resp = await fetch(
            `/api/youtube/metadata?videoId=${encodeURIComponent(v.videoId)}`
          );
          if (resp.ok) {
            const meta = (await resp.json()) as {
              title?: string;
              authorName?: string;
              authorUrl?: string;
              description?: string;
              durationSeconds?: number | null;
              chapters?: VideoChapter[];
            };
            next = {
              ...next,
              title: v.title.startsWith('YouTube Video (') && meta.title ? meta.title : next.title,
              authorName:
                v.authorName.includes('Pending Sync') && meta.authorName
                  ? meta.authorName
                  : next.authorName,
              authorUrl: meta.authorUrl || next.authorUrl,
              description: meta.description || next.description,
              durationSeconds: meta.durationSeconds ?? next.durationSeconds,
              chapters: Array.isArray(meta.chapters) ? meta.chapters : next.chapters ?? [],
            };
            syncedCount++;
          }
        } catch {
          // Ignore individual failures
        }
      }

      if (!v.thumbCached) {
        try {
          const tResp = await fetch(
            `/api/youtube/thumbnail?videoId=${encodeURIComponent(v.videoId)}`
          );
          if (tResp.ok) {
            const blob = await tResp.blob();
            await saveThumbnailBlob(v.videoId, blob);
            next.thumbCached = true;
            syncedCount++;
          }
        } catch {
          // Ignore
        }
      }
      updated.push(next);
    }

    await saveVideosBulk(updated);
    await onRefreshLibrary();
    onStatsChange();
    setSyncing(false);
    setMessage(`Synced ${syncedCount} metadata, chapter & thumbnail cache records.`);
  }

  async function handleClearThumbs() {
    await clearThumbnailCache();
    await onRefreshLibrary();
    onStatsChange();
    setMessage('Cleared cached thumbnails. Links, liked videos, chapters, bookmarks, and notes remain preserved.');
  }

  async function handleRenameCollection(oldName: string) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === oldName) {
      setEditingCollection(null);
      return;
    }
    const affected = videos
      .filter((v) => v.collection === oldName)
      .map((v) => ({...v, collection: trimmed}));
    if (affected.length > 0) {
      await saveVideosBulk(affected);
      await onRefreshLibrary();
    }
    setEditingCollection(null);
    setMessage(`Renamed collection "${oldName}" to "${trimmed}".`);
  }

  function handleExportBackup() {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'TubeVault',
      videos,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tubevault-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('Exported your entire library, liked videos, collections, bookmarks, and notes as JSON.');
  }

  async function handleImportBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {videos?: VideoItem[]};
      if (!Array.isArray(parsed.videos)) {
        throw new Error('Invalid TubeVault backup file.');
      }
      await saveVideosBulk(parsed.videos);
      await onRefreshLibrary();
      onStatsChange();
      setMessage(`Imported ${parsed.videos.length} videos from backup.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Backup import failed');
    } finally {
      e.target.value = '';
    }
  }

  const usagePercent =
    stats.quotaBytes && stats.usageBytes
      ? Math.min(100, Math.max(1, (stats.usageBytes / stats.quotaBytes) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {/* Header + App Tools (moved cleanly out of Top Nav into Library) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Library, Tools &amp; Storage
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage all saved URLs, Liked videos, auto-suggestions, app theme, and backups.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenSuggestions}
            className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] hover:border-rose-500/70 text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-2 cursor-pointer"
          >
            {autoSuggestionsLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500 shrink-0" />
            ) : (
              <Compass className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            )}
            <span>Suggestion</span>
            {autoSuggestionsCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-rose-600/15 text-rose-600 dark:text-rose-400 font-mono text-[10px] font-bold tabular-nums">
                {autoSuggestionsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] hover:border-rose-500/70 text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-2 cursor-pointer"
          >
            {darkMode ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-700" />
                <span>Dark Mode</span>
              </>
            )}
          </button>

          {onOpenAddHub && (
            <button
              type="button"
              onClick={onOpenAddHub}
              className="min-h-[40px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Links</span>
            </button>
          )}

          <PWAInstallButton />
        </div>
      </div>

      {/* Bulk Clear / Protect Liked Videos Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-rose-500" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Clean All Video URLs (Liked Protection)
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <strong>Liked ({likedCount})</strong> videos stay safe when you clear unliked URLs ({unlikedCount}). Only remove liked videos when you explicitly choose &ldquo;Delete All (Including Liked)&rdquo;.
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
            <span className="px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-500 font-semibold">
              {likedCount} Liked
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#1E2430] text-slate-600 dark:text-slate-300">
              {unlikedCount} Unliked
            </span>
          </div>
        </div>

        {confirmMode === 'none' ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={unlikedCount === 0 || deletingBulk}
              onClick={() => setConfirmMode('unliked')}
              className="min-h-[42px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Unliked URLs ({unlikedCount})</span>
            </button>

            <button
              type="button"
              disabled={videos.length === 0 || deletingBulk}
              onClick={() => setConfirmMode('all')}
              className="min-h-[42px] px-4 rounded-xl border border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Delete All Including Liked ({videos.length})</span>
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-medium text-rose-700 dark:text-rose-300">
              {confirmMode === 'unliked'
                ? `Delete ${unlikedCount} unliked video URLs? All ${likedCount} liked videos will remain untouched.`
                : `Delete ALL ${videos.length} videos including ${likedCount} liked video${likedCount === 1 ? '' : 's'}? This cannot be undone.`}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={deletingBulk}
                onClick={() => handleBulkDeleteConfirm(confirmMode === 'all')}
                className="min-h-[38px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
              >
                {deletingBulk
                  ? 'Deleting...'
                  : confirmMode === 'unliked'
                    ? 'Confirm Delete Unliked'
                    : 'Confirm Delete Everything'}
              </button>
              <button
                type="button"
                disabled={deletingBulk}
                onClick={() => setConfirmMode('none')}
                className="min-h-[38px] px-3 rounded-lg border border-slate-300 dark:border-[#2C3446] bg-white dark:bg-[#13161D] text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4-Column Metric Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Saved Videos
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.videoCount}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Liked Videos
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-rose-500">
            {likedCount}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Cached Thumbnails
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.cachedThumbsCount}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Pins &amp; Notes
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {totalBookmarks + totalNotesCount}
          </div>
        </div>
      </div>

      {/* Cache & Backup Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <HardDrive className="w-4 h-4 text-rose-500" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Thumbnail &amp; Metadata Cache
              </h2>
            </div>
            <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {stats.usageBytes != null ? formatBytes(stats.usageBytes) : '—'} /{' '}
              {stats.quotaBytes != null ? formatBytes(stats.quotaBytes) : '—'}
            </span>
          </div>

          <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-[#1E2430] overflow-hidden">
            <div
              className="h-full bg-rose-600 transition-all duration-300"
              style={{width: `${usagePercent}%`}}
            />
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSyncPending}
              disabled={!isOnline || syncing}
              className="min-h-[42px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold disabled:opacity-40 inline-flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing Cache...' : 'Sync Chapters & Thumbnails'}</span>
            </button>

            <button
              type="button"
              onClick={handleClearThumbs}
              disabled={stats.cachedThumbsCount === 0}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-[#242A38] text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-40 inline-flex items-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Thumbnail Cache</span>
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Library &amp; Notes Backup
            </h2>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Export your curated queue, liked videos, collections, chapters, timestamp bookmarks, and study notes as JSON.
          </p>

          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportBackup}
            className="hidden"
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleExportBackup}
              disabled={videos.length === 0}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-[#242A38] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] disabled:opacity-40 inline-flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Library JSON</span>
            </button>

            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-[#242A38] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1C212C] inline-flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import Backup JSON</span>
            </button>
          </div>
        </div>
      </div>

      {/* Collection Organizer */}
      {collectionBreakdown.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <FolderEdit className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Collections
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {collectionBreakdown.map(([col, count]) => (
              <div
                key={col}
                className="rounded-xl border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] px-4 py-3 flex items-center justify-between gap-2"
              >
                {editingCollection === col ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleRenameCollection(col);
                    }}
                    className="flex items-center gap-2 w-full"
                  >
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      autoFocus
                      className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-[#2C3446] bg-white dark:bg-[#13161D] px-2.5 py-1 text-xs text-slate-900 dark:text-white"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-semibold cursor-pointer"
                    >
                      Save
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {col}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {count} video{count === 1 ? '' : 's'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCollection(col);
                        setRenameValue(col);
                      }}
                      className="text-xs font-medium text-slate-500 hover:text-rose-500 cursor-pointer shrink-0"
                    >
                      Rename
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Library Saved URLs List (Like / Protect / Delete individually) */}
      {videos.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Saved Video URLs ({filteredVideos.length})
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              {!externalSearchQuery && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={libSearch}
                    onChange={(e) => setLibSearch(e.target.value)}
                    placeholder="Filter saved URLs..."
                    className="min-h-[36px] w-48 rounded-lg border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] pl-8 pr-3 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}

              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0D11] border border-slate-200 dark:border-[#242A38]">
                {[
                  {id: 'all', label: `All (${videos.length})`},
                  {id: 'liked', label: `Liked (${likedCount})`},
                  {id: 'unliked', label: `Unliked (${unlikedCount})`},
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setLibFilter(tab.id as typeof libFilter)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                      libFilter === tab.id
                        ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-[#1E2430] max-h-[420px] overflow-y-auto pr-1">
            {filteredVideos.map((item) => (
              <div
                key={item.id}
                className="py-2.5 flex items-center gap-3 justify-between"
              >
                <button
                  type="button"
                  onClick={() => onSelectVideo(item.id)}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left group cursor-pointer"
                >
                  <div className="w-16 aspect-video rounded-lg overflow-hidden bg-black shrink-0 relative">
                    <CachedThumbnail
                      videoId={item.videoId}
                      alt={item.title}
                      isOnline={isOnline}
                      fit="cover"
                      className="w-full h-full"
                    />
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
                      <Play className="w-3.5 h-3.5 text-white fill-current" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-rose-500 transition-colors">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {item.authorName} · {item.collection}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleLike(item)}
                    title={item.liked ? 'Liked (Protected)' : 'Like to protect'}
                    className={`min-h-[34px] px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer ${
                      item.liked
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-500'
                        : 'border-slate-200 dark:border-[#242A38] text-slate-500 hover:text-rose-500'
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${item.liked ? 'fill-current' : ''}`} />
                    <span className="hidden sm:inline">{item.liked ? 'Liked' : 'Like'}</span>
                  </button>

                  {item.liked ? (
                    confirmSingleLikedId === item.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmSingleLikedId(null);
                          onDeleteSingleVideo(item);
                        }}
                        className="min-h-[34px] px-2.5 rounded-lg bg-rose-600 text-white text-[11px] font-semibold cursor-pointer"
                      >
                        Remove Liked?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmSingleLikedId(item.id)}
                        title="Liked video — tap once to confirm removal"
                        aria-label={`Remove liked video ${item.title}`}
                        className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => onDeleteSingleVideo(item)}
                      aria-label={`Delete ${item.title}`}
                      className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {message && (
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
};
