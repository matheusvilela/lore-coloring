import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface LoreDB extends DBSchema {
  paint: {
    key: string;
    value: Blob;
  };
}

const DB_NAME = 'lore-coloring';
const STORE = 'paint';
const VERSION = 1;

let dbPromise: Promise<IDBPDatabase<LoreDB>> | null = null;

function database(): Promise<IDBPDatabase<LoreDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LoreDB>(DB_NAME, VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

export function paintKey(letter: string): string {
  return `lore:paint:${letter}`;
}

export async function getPaint(letter: string): Promise<Blob | undefined> {
  return (await database()).get(STORE, paintKey(letter));
}

export async function putPaint(letter: string, blob: Blob): Promise<void> {
  await (await database()).put(STORE, blob, paintKey(letter));
}

export async function deletePaint(letter: string): Promise<void> {
  await (await database()).delete(STORE, paintKey(letter));
}

export async function deleteAllPaint(): Promise<void> {
  await (await database()).clear(STORE);
}

/** Letras que têm blob salvo (sufixo após `lore:paint:`). */
export async function paintedLetters(): Promise<Set<string>> {
  const keys = await (await database()).getAllKeys(STORE);
  const out = new Set<string>();
  for (const key of keys) {
    const match = /^lore:paint:(.+)$/.exec(key);
    if (match) out.add(match[1]!);
  }
  return out;
}

export async function requestPersistentStorage(): Promise<void> {
  if (!navigator.storage?.persist) return;
  try {
    await navigator.storage.persist();
  } catch {
    /* modo privado ou política do navegador */
  }
}