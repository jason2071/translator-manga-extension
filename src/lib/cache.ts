// IndexedDB-backed caches.
//   L1 (images): imgKey -> ImageResult   — kills re-translation on re-scroll.
//   L2 (tm):     normSource -> TMEntry   — reuses identical text across images,
//                                           and seeds a glossary for consistency.

import type { ImageResult } from './types';
import { normalizeText } from './hash';

const DB_NAME = 'manga-translator';
const DB_VERSION = 1;
const STORE_IMAGES = 'images';
const STORE_TM = 'tm';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_IMAGES)) db.createObjectStore(STORE_IMAGES);
      if (!db.objectStoreNames.contains(STORE_TM)) db.createObjectStore(STORE_TM);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ---- L1: image result cache ----

export function getImageResult(key: string): Promise<ImageResult | undefined> {
  return request(STORE_IMAGES, 'readonly', (s) => s.get(key));
}

export async function putImageResult(key: string, result: ImageResult): Promise<void> {
  await request(STORE_IMAGES, 'readwrite', (s) => s.put(result, key));
}

// ---- L2: translation memory ----

export interface TMEntry {
  th: string;
  lang: string;
  count: number;
  ts: number;
}

export function getTM(source: string): Promise<TMEntry | undefined> {
  return request(STORE_TM, 'readonly', (s) => s.get(normalizeText(source)));
}

export async function putTM(source: string, th: string, lang: string): Promise<void> {
  const key = normalizeText(source);
  const existing = await getTM(key);
  const entry: TMEntry = { th, lang, count: (existing?.count ?? 0) + 1, ts: Date.now() };
  await request(STORE_TM, 'readwrite', (s) => s.put(entry, key));
}

/** Derive a small glossary from the most-repeated short TM entries. Fed to the
 *  model so recurring names / SFX / short lines stay consistent. */
export async function getGlossary(limit = 40): Promise<Record<string, string>> {
  const entries: { key: string; val: TMEntry }[] = [];
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const cur = db.transaction(STORE_TM, 'readonly').objectStore(STORE_TM).openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        entries.push({ key: c.key as string, val: c.value as TMEntry });
        c.continue();
      } else resolve();
    };
    cur.onerror = () => reject(cur.error);
  });
  return entries
    .filter((e) => e.key.length <= 16 && e.val.count >= 2)
    .sort((a, b) => b.val.count - a.val.count)
    .slice(0, limit)
    .reduce<Record<string, string>>((acc, e) => {
      acc[e.key] = e.val.th;
      return acc;
    }, {});
}

export async function clearAll(): Promise<void> {
  for (const store of [STORE_IMAGES, STORE_TM]) {
    await request(store, 'readwrite', (s) => s.clear());
  }
}
