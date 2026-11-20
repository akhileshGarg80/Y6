import type {StorageStats, VideoItem} from '../types/video';

const DB_NAME = 'tubevault-offline-db';
const DB_VERSION = 1;

const STORE_VIDEOS = 'videos';
const STORE_THUMBS = 'thumbnails';
const STORE_MEDIA = 'mediaBlobs';
const STORE_SETTINGS = 'settings';

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

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
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
    req.onerror = () => reject(req.error);
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
  const items = await runTx<Array<VideoItem & {sourceType?: string}>>(
    STORE_VIDEOS,
    'readonly',
    (s) => s.getAll()
  );
  // Keep valid YouTube items cleanly sorted newest-first
  return items
    .filter((v) => !v.sourceType || v.sourceType === 'youtube')
    .sort((a, b) => b.addedAt - a.addedAt);
}

export async function saveVideo(item: VideoItem): Promise<void> {
  await runTx(STORE_VIDEOS, 'readwrite', (s) => s.put(item));
}

export async function saveVideosBulk(items: VideoItem[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VIDEOS, 'readwrite');
    const store = tx.objectStore(STORE_VIDEOS);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteVideoRecord(id: string, videoId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_VIDEOS, STORE_THUMBS], 'readwrite');
    tx.objectStore(STORE_VIDEOS).delete(id);
    tx.objectStore(STORE_THUMBS).delete(videoId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveThumbnailBlob(videoId: string, blob: Blob): Promise<void> {
  const record: ThumbnailRecord = {videoId, blob, updatedAt: Date.now()};
  await runTx(STORE_THUMBS, 'readwrite', (s) => s.put(record));
}

export async function getThumbnailBlob(videoId: string): Promise<Blob | null> {
  const rec = await runTx<ThumbnailRecord | undefined>(STORE_THUMBS, 'readonly', (s) =>
    s.get(videoId)
  );
  return rec?.blob ?? null;
}

export async function clearThumbnailCache(): Promise<void> {
  const db = await openDb();
  const videos = await getAllVideos();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_THUMBS, STORE_VIDEOS], 'readwrite');
    tx.objectStore(STORE_THUMBS).clear();
    const videoStore = tx.objectStore(STORE_VIDEOS);
    for (const v of videos) {
      videoStore.put({...v, thumbCached: false});
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rec = await runTx<SettingRecord | undefined>(STORE_SETTINGS, 'readonly', (s) =>
    s.get(key)
  );
  return rec ? (rec.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await runTx(STORE_SETTINGS, 'readwrite', (s) => s.put({key, value}));
}

export async function getStorageStats(): Promise<StorageStats> {
  const [videos, thumbs] = await Promise.all([
    getAllVideos(),
    runTx<ThumbnailRecord[]>(STORE_THUMBS, 'readonly', (s) => s.getAll()),
  ]);

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
    cachedThumbsCount: thumbs.length,
  };
}
