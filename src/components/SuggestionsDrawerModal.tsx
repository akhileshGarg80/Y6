import React, {useState} from 'react';
import {
  Check,
  Compass,
  Copy,
  Link2,
  Loader2,
  Play,
  Plus,
  X,
} from 'lucide-react';
import type {RelatedVideoItem, SuggestedVideoInput} from '../types/video';
import {CachedThumbnail} from './CachedThumbnail';

interface SuggestionsDrawerModalProps {
  sourceVideo: {videoId: string; title: string} | null;
  suggestions: RelatedVideoItem[];
  loading: boolean;
  isOnline: boolean;
  existingVideoIds: Set<string>;
  autoHarvestToHome?: boolean;
  onToggleAutoHarvest?: () => void;
  onPlaySuggestion: (suggested: SuggestedVideoInput) => void;
  onSaveAll: (items: SuggestedVideoInput[]) => Promise<number>;
  onClose: () => void;
}

export const SuggestionsDrawerModal: React.FC<SuggestionsDrawerModalProps> = ({
  sourceVideo,
  suggestions,
  loading,
  isOnline,
  existingVideoIds,
  autoHarvestToHome = true,
  onToggleAutoHarvest,
  onPlaySuggestion,
  onSaveAll,
  onClose,
}) => {
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showRawUrls, setShowRawUrls] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);

  async function copyText(text: string): Promise<boolean> {
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

  async function handleCopyAll() {
    if (suggestions.length === 0) return;
    const allUrls = suggestions.map((s) => s.watchUrl).join('\n');
    const ok = await copyText(allUrls);
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2400);
    } else {
      setShowRawUrls(true);
    }
  }

  async function handleCopyOne(videoId: string, watchUrl: string) {
    const ok = await copyText(watchUrl);
    if (ok) {
      setCopiedId(videoId);
      setTimeout(() => setCopiedId((prev) => (prev === videoId ? null : prev)), 2000);
    } else {
      setShowRawUrls(true);
    }
  }

  async function handleSaveAllClick() {
    if (suggestions.length === 0 || savingAll) return;
    setSavingAll(true);
    try {
      const count = await onSaveAll(
        suggestions.map((s) => ({
          videoId: s.videoId,
          title: s.title,
          authorName: s.authorName,
          authorUrl: s.authorUrl,
          durationSeconds: s.durationSeconds,
        }))
      );
      setSavedFeedback(
        count > 0 ? `Saved ${count} URLs to Library!` : 'All suggested URLs are already saved.'
      );
      setTimeout(() => setSavedFeedback(null), 3000);
    } finally {
      setSavingAll(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Automatic Suggested Video URLs"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-3xl max-h-[88vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-[#1E2430] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-rose-500 shrink-0" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Suggestions URLs {suggestions.length > 0 ? `(${suggestions.length})` : ''}
              </h2>
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-500 shrink-0" />}
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
              {sourceVideo
                ? `Auto-fetched for: ${sourceVideo.title}`
                : 'Click any video to auto-fetch all suggested URLs here'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close suggestions"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1E2430] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Toolbar */}
        {suggestions.length > 0 && (
          <div className="px-4 sm:px-5 py-2.5 border-b border-slate-200 dark:border-[#1E2430] bg-slate-50/70 dark:bg-[#0E1117] flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyAll}
                className={`min-h-[34px] px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  copiedAll
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] text-slate-800 dark:text-white hover:border-rose-500/60'
                }`}
              >
                {copiedAll ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied All {suggestions.length} URLs</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-rose-500" />
                    <span>Copy All URLs ({suggestions.length})</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowRawUrls((v) => !v)}
                className={`min-h-[34px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  showRawUrls
                    ? 'border-rose-600 bg-rose-600/10 text-rose-600 dark:text-rose-400'
                    : 'border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] text-slate-700 dark:text-slate-200 hover:border-rose-500/60'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>{showRawUrls ? 'Hide Raw Box' : 'Raw URLs Box'}</span>
              </button>

              <button
                type="button"
                onClick={handleSaveAllClick}
                disabled={savingAll}
                className="min-h-[34px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {savingAll ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                <span>Save All</span>
              </button>

              {onToggleAutoHarvest && (
                <button
                  type="button"
                  onClick={onToggleAutoHarvest}
                  className={`min-h-[34px] px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    autoHarvestToHome
                      ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'border-slate-200 dark:border-[#242A38] bg-white dark:bg-[#13161D] text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span>Auto-Add to Home: {autoHarvestToHome ? 'ON' : 'OFF'}</span>
                </button>
              )}
            </div>

            {savedFeedback && (
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {savedFeedback}
              </span>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {showRawUrls && suggestions.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                All {suggestions.length} Suggested YouTube Links (Tap inside to select all):
              </div>
              <textarea
                readOnly
                rows={5}
                onFocus={(e) => e.currentTarget.select()}
                value={suggestions.map((s) => s.watchUrl).join('\n')}
                aria-label="Raw list of all suggested YouTube URLs"
                className="w-full rounded-xl border border-slate-200 dark:border-[#242A38] bg-slate-50 dark:bg-[#0B0D11] p-3 font-mono text-[11px] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-600/40"
              />
            </div>
          )}

          {!isOnline ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Internet connection required to fetch live YouTube suggestions.
            </div>
          ) : loading && suggestions.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin text-rose-500" />
              <span>Fetching all suggested URLs automatically...</span>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Play or click any video to automatically see all its suggested video URLs here.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-[#1E2430]">
              {suggestions.map((item, idx) => {
                const isSaved = existingVideoIds.has(item.videoId);
                const isCopied = copiedId === item.videoId;
                return (
                  <div
                    key={item.videoId}
                    className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onPlaySuggestion({
                          videoId: item.videoId,
                          title: item.title,
                          authorName: item.authorName,
                          authorUrl: item.authorUrl,
                          durationSeconds: item.durationSeconds,
                        });
                        onClose();
                      }}
                      className="flex items-start gap-3 min-w-0 flex-1 text-left group cursor-pointer"
                    >
                      <div className="relative w-28 sm:w-32 aspect-video rounded-lg overflow-hidden bg-black shrink-0">
                        <CachedThumbnail
                          videoId={item.videoId}
                          alt={item.title}
                          isOnline={isOnline}
                          fit="cover"
                          className="w-full h-full group-hover:scale-105 transition-transform"
                        />
                        {item.durationText && (
                          <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1 py-0.5 font-mono text-[10px] text-white tabular-nums">
                            {item.durationText}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white line-clamp-2 group-hover:text-rose-500 transition-colors">
                          {idx + 1}. {item.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {item.authorName}
                          {item.viewText ? ` · ${item.viewText}` : ''}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-rose-600 dark:text-rose-400 truncate">
                          {item.watchUrl}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                      {isSaved && (
                        <span className="px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold">
                          Saved
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopyOne(item.videoId, item.watchUrl)}
                        className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-[#242A38] text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-rose-500/60 inline-flex items-center gap-1 cursor-pointer"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onPlaySuggestion({
                            videoId: item.videoId,
                            title: item.title,
                            authorName: item.authorName,
                            authorUrl: item.authorUrl,
                            durationSeconds: item.durationSeconds,
                          });
                          onClose();
                        }}
                        className="min-h-[34px] px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Play</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
