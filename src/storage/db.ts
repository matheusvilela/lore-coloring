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

function historyKey(letter: string): string {
  return `lore:history:${letter}`;
}

function baseKey(letter: string): string {
  return `lore:base:${letter}`;
}

export async function getPaint(letter: string): Promise<Blob | undefined> {
  return (await database()).get(STORE, paintKey(letter));
}

export async function putPaint(letter: string, blob: Blob): Promise<void> {
  await (await database()).put(STORE, blob, paintKey(letter));
}

export async function getHistory(letter: string): Promise<Blob | undefined> {
  return (await database()).get(STORE, historyKey(letter));
}

export async function putHistory(letter: string, json: string): Promise<void> {
  const blob = new Blob([json], { type: 'application/json' });
  await (await database()).put(STORE, blob, historyKey(letter));
}

export async function deleteHistory(letter: string): Promise<void> {
  await (await database()).delete(STORE, historyKey(letter));
}

export async function getBase(letter: string): Promise<Blob | undefined> {
  return (await database()).get(STORE, baseKey(letter));
}

export async function putBase(letter: string, blob: Blob): Promise<void> {
  await (await database()).put(STORE, blob, baseKey(letter));
}

export async function deleteBase(letter: string): Promise<void> {
  await (await database()).delete(STORE, baseKey(letter));
}

export async function deletePaint(letter: string): Promise<void> {
  const db = await database();
  await Promise.all([
    db.delete(STORE, paintKey(letter)),
    db.delete(STORE, historyKey(letter)),
    db.delete(STORE, baseKey(letter)),
  ]);
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