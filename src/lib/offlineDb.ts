import type {StorageStats, VideoItem} from '../types/video';

const DB_NAME = 'tubevault-offline-db';
const DB_VERSION = 1;

const STORE_VIDEOS = 'videos';
const STORE_THUMBS = 'thumbnails';
const STORE_MEDIA = 'mediaBlobs';
const STORE_SETTINGS = 'settings';

const LS_VIDEOS_KEY = 'tubevault_videos_v1';
const LS_SETTINGS_KEY = 'tubevault_settings_v1';

interface ThumbnailRecord {
  videoId: string;
  blob: Blob;
  updatedAt: number;
}

interface SettingRecord {
  key: string;
  value: unknown;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let persistRequested = false;

export function requestPersistentStorage(): void {
  if (persistRequested || typeof navigator === 'undefined') return;
  persistRequested = true;
  try {
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {
        // Ignore permission denial on platforms that manage storage automatically
      });
    }
  } catch {
    // Ignore
  }
}

function readLocalStorageJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeVideosToLocalStorage(items: VideoItem[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const sorted = [...items].sort((a, b) => b.addedAt - a.addedAt);
  try {
    window.localStorage.setItem(LS_VIDEOS_KEY, JSON.stringify(sorted));
  } catch {
    // If localStorage quota is tight, strip long descriptions first while keeping all URLs, titles, chapters, notes & bookmarks
    try {
      const compact = sorted.map((v) => ({
        ...v,
        description: v.description ? v.description.slice(0, 240) : '',
      }));
      window.localStorage.setItem(LS_VIDEOS_KEY, JSON.stringify(compact));
    } catch {
      // Final safety: keep latest 350 items compactly in localStorage
      try {
        const sliced = sorted.slice(0, 350).map((v) => ({
          ...v,
          description: '',
        }));
        window.localStorage.setItem(LS_VIDEOS_KEY, JSON.stringify(sliced));
      } catch {
        // Quota exhausted cleanly; IndexedDB still holds full data
      }
    }
  }
}

function readSettingsFromLocalStorage(): Record<string, unknown> {
  const parsed = readLocalStorageJson<Record<string, unknown>>(LS_SETTINGS_KEY, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function writeSettingToLocalStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const current = readSettingsFromLocalStorage();
    current[key] = value;
    window.localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // Ignore localStorage quota failure
  }
}

export function getCachedVideosSync(): VideoItem[] {
  const cached = readLocalStorageJson<Array<VideoItem & {sourceType?: string}>>(LS_VIDEOS_KEY, []);
  if (!Array.isArray(cached)) return [];
  return cached
    .filter((v) => v && typeof v.id === 'string' && typeof v.videoId === 'string' && (!v.sourceType || v.sourceType === 'youtube'))
    .sort((a, b) => b.addedAt - a.addedAt);
}

export function getCachedSettingSync<T>(key: string, fallback: T): T {
  const settings = readSettingsFromLocalStorage();
  if (Object.prototype.hasOwnProperty.call(settings, key)) {
    return settings[key] as T;
  }
  return fallback;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        db.createObjectStore(STORE_VIDEOS, {keyPath: 'id'});
      }
      if (!db.objectStoreNames.contains(STORE_THUMBS)) {
        db.createObjectStore(STORE_THUMBS, {keyPath: 'videoId'});
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, {keyPath: 'videoId'});
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, {keyPath: 'key'});
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });

  return dbPromise;
}

function runTx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

export async function getAllVideos(): Promise<VideoItem[]> {
  try {
    const items = await runTx<Array<VideoItem & {sourceType?: string}>>(
      STORE_VIDEOS,
      'readonly',
      (s) => s.getAll()
    );
    const valid = items
      .filter((v) => !v.sourceType || v.sourceType === 'youtube')
      .sort((a, b) => b.addedAt - a.addedAt);

    if (valid.length > 0) {
      writeVideosToLocalStorage(valid);
      return valid;
    }

    // Rehydrate IndexedDB automatically if localStorage has data from a fast/prior session
    const lsFallback = getCachedVideosSync();
    if (lsFallback.length > 0) {
      saveVideosBulk(lsFallback).catch(() => {});
      return lsFallback;
    }

    return [];
  } catch {
    return getCachedVideosSync();
  }
}

export async function saveVideo(item: VideoItem): Promise<void> {
  const current = getCachedVideosSync();
  const idx = current.findIndex((v) => v.id === item.id);
  const next = idx >= 0 ? current.map((v) => (v.id === item.id ? item : v)) : [item, ...current];
  writeVideosToLocalStorage(next);

  try {
    await runTx(STORE_VIDEOS, 'readwrite', (s) => s.put(item));
  } catch {
    // localStorage already saved safely
  }
}

export async function saveVideosBulk(items: VideoItem[]): Promise<void> {
  if (items.length === 0) return;

  const byId = new Map<string, VideoItem>();
  for (const existing of getCachedVideosSync()) {
    byId.set(existing.id, existing);
  }
  for (const incoming of items) {
    byId.set(incoming.id, incoming);
  }
  writeVideosToLocalStorage(Array.from(byId.values()));

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_VIDEOS, 'readwrite');
      const store = tx.objectStore(STORE_VIDEOS);
      for (const item of items) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // localStorage mirror succeeded
  }
}

export async function deleteVideoRecord(id: string, videoId: string): Promise<void> {
  const remaining = getCachedVideosSync().filter((v) => v.id !== id);
  writeVideosToLocalStorage(remaining);

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_VIDEOS, STORE_THUMBS], 'readwrite');
      tx.objectStore(STORE_VIDEOS).delete(id);
      tx.objectStore(STORE_THUMBS).delete(videoId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // localStorage mirror succeeded
  }
}

export async function saveThumbnailBlob(videoId: string, blob: Blob): Promise<void> {
  try {
    const record: ThumbnailRecord = {videoId, blob, updatedAt: Date.now()};
    await runTx(STORE_THUMBS, 'readwrite', (s) => s.put(record));
  } catch {
    // Ignore IDB blob write error cleanly
  }
}

export async function getThumbnailBlob(videoId: string): Promise<Blob | null> {
  try {
    const rec = await runTx<ThumbnailRecord | undefined>(STORE_THUMBS, 'readonly', (s) =>
      s.get(videoId)
    );
    return rec?.blob ?? null;
  } catch {
    return null;
  }
}

export async function clearThumbnailCache(): Promise<void> {
  const cached = getCachedVideosSync().map((v) => ({...v, thumbCached: false}));
  writeVideosToLocalStorage(cached);

  try {
    const db = await openDb();
    const videos = await getAllVideos();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_THUMBS, STORE_VIDEOS], 'readwrite');
      tx.objectStore(STORE_THUMBS).clear();
      const videoStore = tx.objectStore(STORE_VIDEOS);
      for (const v of videos) {
        videoStore.put({...v, thumbCached: false});
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const rec = await runTx<SettingRecord | undefined>(STORE_SETTINGS, 'readonly', (s) =>
      s.get(key)
    );
    if (rec) {
      writeSettingToLocalStorage(key, rec.value);
      return rec.value as T;
    }
    return getCachedSettingSync(key, fallback);
  } catch {
    return getCachedSettingSync(key, fallback);
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  writeSettingToLocalStorage(key, value);
  try {
    await runTx(STORE_SETTINGS, 'readwrite', (s) => s.put({key, value}));
  } catch {
    // localStorage already updated
  }
}

export async function getStorageStats(): Promise<StorageStats> {
  let videos: VideoItem[] = getCachedVideosSync();
  let thumbsCount = 0;

  try {
    const [idbVideos, thumbs] = await Promise.all([
      getAllVideos(),
      runTx<ThumbnailRecord[]>(STORE_THUMBS, 'readonly', (s) => s.getAll()),
    ]);
    if (idbVideos.length > 0) videos = idbVideos;
    thumbsCount = thumbs.length;
  } catch {
    thumbsCount = videos.filter((v) => v.thumbCached).length;
  }

  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      quotaBytes = est.quota ?? null;
      usageBytes = est.usage ?? null;
    } catch {
      // Ignore storage estimate unavailability
    }
  }

  return {
    quotaBytes,
    usageBytes,
    videoCount: videos.length,
    cachedThumbsCount: thumbsCount,
  };
}
