const DB_NAME = 'residenze_photos';
const STORE_NAME = 'photos';
const COMPRESSED_STORE = 'compressed';
const DB_VERSION = 2;

type PhotoRecord = {
  id: string;
  data: string;
  savedAt: number;
};

type CompressedPhotoRecord = {
  fingerprint: string;
  dataUrl: string;
  cachedAt: number;
};

type ArchivableRequest = {
  id: string;
  status: string;
  photos?: string[];
};

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(COMPRESSED_STORE)) {
        db.createObjectStore(COMPRESSED_STORE, { keyPath: 'fingerprint' });
      }
    };
    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function savePhoto(id: string, data: string): Promise<void> {
  try {
    const db = await openDB();
    return await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id, data, savedAt: Date.now() } satisfies PhotoRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn('[photoCache] save failed:', error);
  }
}

export async function getPhoto(id: string): Promise<string | null> {
  try {
    const db = await openDB();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as PhotoRecord | undefined)?.data ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deletePhoto(id: string): Promise<void> {
  try {
    const db = await openDB();
    return await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

const ARCHIVE_STATUSES = new Set(['arrived', 'rejected', 'expired', 'cancelled']);

export async function archiveCompletedPhotos(requests: ArchivableRequest[]): Promise<number> {
  const LS_KEY = 'residenze_v5';
  let migrated = 0;

  for (const request of requests) {
    if (!ARCHIVE_STATUSES.has(request.status)) continue;

    const photoKey = `${LS_KEY}_ph_${request.id}`;
    const photo = localStorage.getItem(photoKey);
    if (photo) {
      await savePhoto(request.id, photo);
      localStorage.removeItem(photoKey);
      migrated++;
    }

    for (let index = 0; index < (request.photos?.length ?? 0); index++) {
      const key = `${LS_KEY}_ph_${request.id}_${index}`;
      const data = localStorage.getItem(key);
      if (data) {
        await savePhoto(`${request.id}_${index}`, data);
        localStorage.removeItem(key);
        migrated++;
      }
    }
  }

  if (migrated > 0) {
    console.info(`[photoCache] archived ${migrated} photos from localStorage to IndexedDB`);
  }
  return migrated;
}

export async function clearAll(): Promise<void> {
  try {
    const db = await openDB();
    return await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function cacheCompressed(fingerprint: string, dataUrl: string): Promise<void> {
  try {
    const db = await openDB();
    return await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COMPRESSED_STORE, 'readwrite');
      tx.objectStore(COMPRESSED_STORE).put({ fingerprint, dataUrl, cachedAt: Date.now() } satisfies CompressedPhotoRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn('[photoCache] cacheCompressed failed:', error);
  }
}

export async function getCachedCompressed(fingerprint: string): Promise<string | null> {
  try {
    const db = await openDB();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(COMPRESSED_STORE, 'readonly');
      const req = tx.objectStore(COMPRESSED_STORE).get(fingerprint);
      req.onsuccess = () => resolve((req.result as CompressedPhotoRecord | undefined)?.dataUrl ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
