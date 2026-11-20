import React, {useEffect, useState} from 'react';
import {Film} from 'lucide-react';
import {getThumbnailBlob, saveThumbnailBlob} from '../lib/offlineDb';

interface CachedThumbnailProps {
  videoId: string;
  alt: string;
  isOnline: boolean;
  fit?: 'contain' | 'cover';
  className?: string;
}

export const CachedThumbnail: React.FC<CachedThumbnailProps> = ({
  videoId,
  alt,
  isOnline,
  fit = 'contain',
  className = '',
}) => {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setFailed(false);

    async function loadThumb() {
      try {
        const cachedBlob = await getThumbnailBlob(videoId);
        if (cachedBlob && active) {
          objectUrl = URL.createObjectURL(cachedBlob);
          setSrcUrl(objectUrl);
          return;
        }

        if (!isOnline) {
          if (active) setFailed(true);
          return;
        }

        const resp = await fetch(`/api/youtube/thumbnail?videoId=${encodeURIComponent(videoId)}`);
        if (!resp.ok) {
          if (active) setFailed(true);
          return;
        }
        const blob = await resp.blob();
        await saveThumbnailBlob(videoId, blob);
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setSrcUrl(objectUrl);
        }
      } catch {
        if (active) setFailed(true);
      }
    }

    loadThumb();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [videoId, isOnline]);

  if (failed || !srcUrl) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 dark:from-[#171B24] dark:to-[#10131A] text-slate-500 dark:text-slate-400 select-none ${className}`}
      >
        <Film className="w-6 h-6 opacity-60" />
        <span className="mt-1 font-mono text-[10px] tracking-tight opacity-70">{videoId}</span>
      </div>
    );
  }

  return (
    <img
      src={srcUrl}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${fit === 'cover' ? 'object-cover' : 'object-contain bg-black'} ${className}`}
    />
  );
};
