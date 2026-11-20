import React, {useRef, useState} from 'react';
import {CheckCircle2, FileUp, Link2, Search, X} from 'lucide-react';
import {saveVideosBulk} from '../lib/offlineDb';
import {AddLinksPanel} from './AddLinksPanel';
import type {VideoItem} from '../types/video';

interface QuickAddHubModalProps {
  existingVideoIds: Set<string>;
  collections: string[];
  isOnline: boolean;
  onAddedLinks: (items: VideoItem[]) => void;
  onImportedLibrary: () => Promise<void>;
  onOpenDiscover: (initialQuery?: string) => void;
  onClose: () => void;
}

export const QuickAddHubModal: React.FC<QuickAddHubModalProps> = ({
  existingVideoIds,
  collections,
  isOnline,
  onAddedLinks,
  onImportedLibrary,
  onOpenDiscover,
  onClose,
}) => {
  const [tab, setTab] = useState<'links' | 'search' | 'import'>('links');
  const [quickQuery, setQuickQuery] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function handleQuickSearch(e: React.FormEvent) {
    e.preventDefault();
    onClose();
    onOpenDiscover(quickQuery.trim() || undefined);
  }

  async function handleJsonImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {videos?: VideoItem[]};
      if (!Array.isArray(parsed.videos)) {
        throw new Error('Invalid TubeVault JSON playlist file.');
      }
      await saveVideosBulk(parsed.videos);
      await onImportedLibrary();
      setImportMsg(`Imported ${parsed.videos.length} videos & notes from ${file.name}.`);
      setTimeout(() => onClose(), 550);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import JSON');
    } finally {
      e.target.value = '';
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-[#1E2430] bg-white dark:bg-[#13161D] p-5 sm:p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto -mt-1 mb-2" />

        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              Add to TubeVault
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Paste YouTube links, playlists or @channels, search YouTube directly, or restore a saved playlist JSON.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick add hub"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1C212C] hover:text-slate-900 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Unified Action Switcher */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0B0D11] border border-slate-200 dark:border-[#242A38]">
          <button
            type="button"
            onClick={() => setTab('links')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-medium transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
              tab === 'links'
                ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Link2 className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            <span className="truncate">YouTube Links</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('search')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-medium transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
              tab === 'search'
                ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Search className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            <span className="truncate">Search YouTube</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('import')}
            className={`min-h-[38px] px-2.5 rounded-lg text-xs font-medium transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
              tab === 'import'
                ? 'bg-white dark:bg-[#1E2430] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <FileUp className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            <span className="truncate">Import JSON</span>
          </button>
        </div>

        {tab === 'links' && (
          <AddLinksPanel
            existingVideoIds={existingVideoIds}
            collections={collections}
            isOnline={isOnline}
            onAdded={onAddedLinks}
            onClose={onClose}
            onOpenDiscover={() => onOpenDiscover()}
            embedded
          />
        )}

        {tab === 'search' && (
          <form onSubmit={handleQuickSearch} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="quick-hub-search"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Search Any YouTube Video, Music Track, Playlist, or @Channel
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="quick-hub-search"
                  type="text"
                  value={quickQuery}
                  onChange={(e) => setQuickQuery(e.target.value)}
                  placeholder="e.g. Lofi Hip Hop, @Fireship, Acoustic Sessions..."
                  autoFocus
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] pl-10 pr-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-600/50"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Search className="w-4 h-4" />
              <span>{quickQuery.trim() ? 'Search Now' : 'Open Discover & Channel Search'}</span>
            </button>
          </form>
        )}

        {tab === 'import' && (
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={handleJsonImport}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-2xl border-2 border-dashed border-slate-300 dark:border-[#242A38] hover:border-rose-500/70 bg-slate-50 dark:bg-[#0B0D11] p-8 text-center space-y-2 transition-colors cursor-pointer"
            >
              <FileUp className="w-7 h-7 text-rose-500 mx-auto" />
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Select TubeVault JSON Backup
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Restores queued links, collections, pinned timestamp bookmarks, chapters, and notes.
              </p>
            </button>

            {importError && <p className="text-xs text-rose-600 dark:text-rose-400">{importError}</p>}
            {importMsg && (
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{importMsg}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
