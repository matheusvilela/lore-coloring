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

function historyKey(letter: string): string {
  return `lore:history:${letter}`;
}

function baseKey(letter: string): string {
  return `lore:base:${letter}`;
}

export async function getPaint(letter: string): Promise<Blob | undefined> {
  await awaitPaintWrites(letter);
  return (await database()).get(STORE, paintKey(letter));
}

export async function getHistory(letter: string): Promise<Blob | undefined> {
  await awaitPaintWrites(letter);
  return (await database()).get(STORE, historyKey(letter));
}

export async function getBase(letter: string): Promise<Blob | undefined> {
  await awaitPaintWrites(letter);
  return (await database()).get(STORE, baseKey(letter));
}

export type LetterPersistSnapshot = {
  paint: Blob | null;
  historyJson: string | null;
  base: Blob | null;
};

/**
 * Persiste PNG da grade, histórico JSON e base legada numa única escrita
 * ordenada (captura síncrona do histórico; blobs async depois).
 */
export function queueLetterPersist(
  letter: string,
  snapshotPromise: Promise<LetterPersistSnapshot>,
): Promise<void> {
  const seq = bumpWriteSeq(letter);
  return enqueue(letter, async () => {
    const snapshot = await snapshotPromise;
    if (writeSeq.get(letter) !== seq) return;
    const db = await database();
    if (snapshot.paint) await db.put(STORE, snapshot.paint, paintKey(letter));
    else await db.delete(STORE, paintKey(letter));

    if (snapshot.historyJson) {
      const blob = new Blob([snapshot.historyJson], { type: 'application/json' });
      await db.put(STORE, blob, historyKey(letter));
    } else {
      await db.delete(STORE, historyKey(letter));
    }

    if (snapshot.base) await db.put(STORE, snapshot.base, baseKey(letter));
    else await db.delete(STORE, baseKey(letter));
  });
}

/** @deprecated Preferir queueLetterPersist; mantido para compat pontual. */
export function queuePaintWrite(letter: string, blobPromise: Promise<Blob | null>): Promise<void> {
  return queueLetterPersist(
    letter,
    blobPromise.then((paint) => ({ paint, historyJson: null, base: null })),
  );
}

export function queuePaintDelete(letter: string): Promise<void> {
  const seq = bumpWriteSeq(letter);
  return enqueue(letter, async () => {
    if (writeSeq.get(letter) !== seq) return;
    const db = await database();
    await Promise.all([
      db.delete(STORE, paintKey(letter)),
      db.delete(STORE, historyKey(letter)),
      db.delete(STORE, baseKey(letter)),
    ]);
  });
}

/**
 * Apaga a pintura das letras informadas. Recebe chaves de armazenamento, não
 * letras soltas: "limpar tudo" na grade apaga só o alfabeto da tela, então não
 * pode dar `clear()` no store inteiro.
 */
export async function queueDeleteAllPaint(keys: readonly string[]): Promise<void> {
  for (const key of keys) bumpWriteSeq(key);
  await Promise.all(keys.map((key) => awaitPaintWrites(key)));
  const db = await database();
  await Promise.all(
    keys.flatMap((key) => [
      db.delete(STORE, paintKey(key)),
      db.delete(STORE, historyKey(key)),
      db.delete(STORE, baseKey(key)),
    ]),
  );
}

/** Chaves de armazenamento que têm pintura salva (sufixo após `lore:paint:`). */
export async function paintedKeys(): Promise<Set<string>> {
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