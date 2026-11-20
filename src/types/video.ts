export interface VideoBookmark {
  id: string;
  timeSeconds: number;
  label: string;
  createdAt: number;
}

export interface VideoChapter {
  timeSeconds: number;
  label: string;
}

export interface VideoItem {
  id: string;
  videoId: string;
  originalUrl: string;
  title: string;
  authorName: string;
  authorUrl: string;
  description: string;
  durationSeconds: number | null;
  collection: string;
  addedAt: number;
  lastWatchedAt: number | null;
  lastPositionSeconds: number;
  playbackRate: number;
  bookmarks: VideoBookmark[];
  chapters?: VideoChapter[];
  notes: string;
  thumbCached: boolean;
}

export interface StorageStats {
  quotaBytes: number | null;
  usageBytes: number | null;
  videoCount: number;
  cachedThumbsCount: number;
}

export type AppView = 'home' | 'music' | 'player' | 'discover' | 'storage';

export interface ActivePlayback {
  source: 'stage' | 'inline' | 'music';
  key: string;
  token: number;
}
