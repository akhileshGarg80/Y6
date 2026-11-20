import React, {useMemo, useRef, useState} from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  FolderEdit,
  HardDrive,
  RefreshCw,
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

interface StorageManagerViewProps {
  stats: StorageStats;
  videos: VideoItem[];
  isOnline: boolean;
  onRefreshLibrary: () => Promise<void>;
  onStatsChange: () => void;
}

export const StorageManagerView: React.FC<StorageManagerViewProps> = ({
  stats,
  videos,
  isOnline,
  onRefreshLibrary,
  onStatsChange,
}) => {
  const importRef = useRef<HTMLInputElement | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editingCollection, setEditingCollection] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

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
    setMessage('Cleared cached thumbnails. Links, chapters, bookmarks, and notes remain preserved.');
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
    setMessage('Exported your entire library, collections, bookmarks, and notes as JSON.');
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Library &amp; Thumbnail Cache
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage cached thumbnails, sync YouTube chapters &amp; metadata, organize collections, and back up your pinned timestamps and notes.
        </p>
      </div>

      {/* 4-Column Metric Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Queued Videos
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.videoCount}
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
            Pinned Timestamps
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {totalBookmarks}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Videos With Notes
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {totalNotesCount}
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
            Export your curated queue, collections, chapters, timestamp bookmarks, and study notes as portable JSON to move across devices or share playlists.
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

      {message && (
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
};
