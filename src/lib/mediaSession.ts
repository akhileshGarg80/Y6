export interface MediaSessionHandlers {
  onPlay: () => void;
  onPause: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onSeekTo?: (seconds: number) => void;
  onSeekBy?: (deltaSeconds: number) => void;
}

export function updateMediaSession(
  track: {
    videoId: string;
    title: string;
    authorName: string;
    collection?: string;
  } | null,
  state: {
    isPlaying: boolean;
    duration: number;
    currentTime: number;
    playbackRate: number;
  },
  handlers: MediaSessionHandlers
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

  const ms = navigator.mediaSession;
  if (!track) {
    ms.playbackState = 'none';
    return;
  }

  try {
    if (typeof MediaMetadata !== 'undefined') {
      ms.metadata = new MediaMetadata({
        title: track.title,
        artist: track.authorName || 'YouTube',
        album: track.collection ? `TubeVault · ${track.collection}` : 'TubeVault',
        artwork: [
          {
            src: `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`,
            sizes: '480x360',
            type: 'image/jpeg',
          },
          {
            src: `https://i.ytimg.com/vi/${track.videoId}/maxresdefault.jpg`,
            sizes: '1280x720',
            type: 'image/jpeg',
          },
        ],
      });
    }

    ms.playbackState = state.isPlaying ? 'playing' : 'paused';

    if (
      typeof ms.setPositionState === 'function' &&
      Number.isFinite(state.duration) &&
      state.duration > 0
    ) {
      const clampedPos = Math.min(state.duration, Math.max(0, state.currentTime || 0));
      ms.setPositionState({
        duration: state.duration,
        playbackRate: state.playbackRate || 1,
        position: clampedPos,
      });
    }
  } catch {
    // Some browsers reject position updates during buffering
  }

  const safeBind = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      // Action not supported on this platform
    }
  };

  safeBind('play', () => handlers.onPlay());
  safeBind('pause', () => handlers.onPause());
  safeBind('nexttrack', handlers.onNext ? () => handlers.onNext?.() : null);
  safeBind('previoustrack', handlers.onPrev ? () => handlers.onPrev?.() : null);
  safeBind(
    'seekbackward',
    handlers.onSeekBy ? (details) => handlers.onSeekBy?.(-(details.seekOffset || 10)) : null
  );
  safeBind(
    'seekforward',
    handlers.onSeekBy ? (details) => handlers.onSeekBy?.(details.seekOffset || 10) : null
  );
  safeBind(
    'seekto',
    handlers.onSeekTo
      ? (details) => {
          if (typeof details.seekTime === 'number') {
            handlers.onSeekTo?.(details.seekTime);
          }
        }
      : null
  );
}
