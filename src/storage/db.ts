import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { LETTERS } from '../data/letters';

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

/** Versão monotônica por letra: escritas obsoletas não sobrescrevem as novas. */
const writeSeq = new Map<string, number>();
const writeTail = new Map<string, Promise<void>>();

function bumpWriteSeq(letter: string): number {
  const next = (writeSeq.get(letter) ?? 0) + 1;
  writeSeq.set(letter, next);
  return next;
}

function enqueue(letter: string, run: () => Promise<void>): Promise<void> {
  const prev = writeTail.get(letter) ?? Promise.resolve();
  const next = prev.then(run, run);
  writeTail.set(letter, next);
  return next;
}

export async function awaitPaintWrites(letter: string): Promise<void> {
  await (writeTail.get(letter) ?? Promise.resolve());
}

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
  await awaitPaintWrites(letter);
  return (await database()).get(STORE, paintKey(letter));
}

/** Persiste o snapshot (null apaga). A captura de pixels deve ocorrer antes do primeiro await da Promise. */
export function queuePaintWrite(letter: string, blobPromise: Promise<Blob | null>): Promise<void> {
  const seq = bumpWriteSeq(letter);
  return enqueue(letter, async () => {
    const blob = await blobPromise;
    if (writeSeq.get(letter) !== seq) return;
    const db = await database();
    if (blob) await db.put(STORE, blob, paintKey(letter));
    else await db.delete(STORE, paintKey(letter));
  });
}

export function queuePaintDelete(letter: string): Promise<void> {
  const seq = bumpWriteSeq(letter);
  return enqueue(letter, async () => {
    if (writeSeq.get(letter) !== seq) return;
    await (await database()).delete(STORE, paintKey(letter));
  });
}

export async function queueDeleteAllPaint(): Promise<void> {
  for (const letter of LETTERS) bumpWriteSeq(letter);
  await Promise.all([...LETTERS].map((letter) => awaitPaintWrites(letter)));
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