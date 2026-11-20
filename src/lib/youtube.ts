export interface ParsedYouTubeLink {
  videoId: string;
  originalUrl: string;
}

export interface ParsedPlaylistLink {
  listId: string;
  seedVideoId: string | null;
  originalUrl: string;
}

export interface ParsedChannelInput {
  handle: string;
  originalUrl: string;
}

export interface ParsedYouTubeInputs {
  videos: ParsedYouTubeLink[];
  playlists: ParsedPlaylistLink[];
  channels: ParsedChannelInput[];
}

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_ID_REGEX = /^[a-zA-Z0-9_-]{4,80}$/;

export function extractVideoIdFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');

    if (host === 'youtu.be') {
      const seg = url.pathname.split('/').filter(Boolean)[0];
      if (seg && YOUTUBE_ID_REGEX.test(seg)) return seg;
    }

    if (
      host === 'youtube.com' ||
      host === 'youtube-nocookie.com' ||
      host === 'music.youtube.com'
    ) {
      const vParam = url.searchParams.get('v');
      if (vParam && YOUTUBE_ID_REGEX.test(vParam)) return vParam;

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const prefix = parts[0];
        const idPart = parts[1];
        if (
          (prefix === 'embed' || prefix === 'shorts' || prefix === 'live' || prefix === 'v') &&
          YOUTUBE_ID_REGEX.test(idPart)
        ) {
          return idPart;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function extractYouTubeInputs(bulkText: string): ParsedYouTubeInputs {
  const tokens = bulkText
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const seenVideos = new Set<string>();
  const seenPlaylists = new Set<string>();
  const seenChannels = new Set<string>();

  const videos: ParsedYouTubeLink[] = [];
  const playlists: ParsedPlaylistLink[] = [];
  const channels: ParsedChannelInput[] = [];

  for (const token of tokens) {
    const cleaned = token.replace(/[)\].,!?"']+$/, '');

    // Bare @username handle
    if (/^@[a-zA-Z0-9._-]{2,50}$/.test(cleaned)) {
      if (!seenChannels.has(cleaned.toLowerCase())) {
        seenChannels.add(cleaned.toLowerCase());
        channels.push({
          handle: cleaned,
          originalUrl: `https://www.youtube.com/${cleaned}`,
        });
      }
      continue;
    }

    let candidate = cleaned;
    if (!/^https?:\/\//i.test(candidate) && candidate.includes('youtube.com')) {
      candidate = `https://${candidate}`;
    }

    let handledAsSpecial = false;
    try {
      const url = new URL(candidate);
      const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
      if (
        host === 'youtube.com' ||
        host === 'youtube-nocookie.com' ||
        host === 'music.youtube.com'
      ) {
        const listParam = url.searchParams.get('list');
        const vParam = url.searchParams.get('v');
        if (listParam && PLAYLIST_ID_REGEX.test(listParam)) {
          if (!seenPlaylists.has(listParam)) {
            seenPlaylists.add(listParam);
            playlists.push({
              listId: listParam,
              seedVideoId: vParam && YOUTUBE_ID_REGEX.test(vParam) ? vParam : null,
              originalUrl: cleaned,
            });
          }
          handledAsSpecial = true;
        } else {
          const parts = url.pathname.split('/').filter(Boolean);
          if (
            parts[0] &&
            (parts[0].startsWith('@') ||
              parts[0] === 'channel' ||
              parts[0] === 'c' ||
              parts[0] === 'user')
          ) {
            const handlePath =
              parts[0].startsWith('@') ? parts[0] : `/${parts[0]}/${parts[1] || ''}`;
            const norm = handlePath.toLowerCase();
            if (!seenChannels.has(norm)) {
              seenChannels.add(norm);
              channels.push({handle: handlePath, originalUrl: cleaned});
            }
            handledAsSpecial = true;
          }
        }
      }
    } catch {
      // Not a full URL
    }

    if (handledAsSpecial) continue;

    const videoId = extractVideoIdFromUrl(cleaned);
    if (videoId && !seenVideos.has(videoId)) {
      seenVideos.add(videoId);
      videos.push({
        videoId,
        originalUrl: /^https?:\/\//i.test(cleaned)
          ? cleaned
          : `https://www.youtube.com/watch?v=${videoId}`,
      });
    }
  }

  return {videos, playlists, channels};
}

export function extractYouTubeLinks(bulkText: string): ParsedYouTubeLink[] {
  return extractYouTubeInputs(bulkText).videos;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let unitIdx = 0;
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024;
    unitIdx++;
  }
  return `${val >= 10 || unitIdx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[unitIdx]}`;
}

export function formatRelativeDate(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
