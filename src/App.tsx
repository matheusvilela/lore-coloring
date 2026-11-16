import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseSavedHistory } from './canvas/history';
import { CANVAS_H, CANVAS_W, Painter, type HistoryState } from './canvas/Painter';
import type { SizeIndex, Tool } from './canvas/tools';
import { usePinchZoom } from './canvas/zoom';
import { Confirm } from './components/Confirm';
import { Dock } from './components/Dock';
import { LetterGrid } from './components/LetterGrid';
import { LETTERS, assetUrl, type Letter } from './data/letters';
import { DEFAULT_COLOR } from './data/palette';
import {
  getBase,
  getHistory,
  getPaint,
  paintedLetters,
  queueDeleteAllPaint,
  queueLetterPersist,
  queuePaintDelete,
  requestPersistentStorage,
} from './storage/db';

type Screen = 'studio' | 'grid';
type SheetSize = { w: number; h: number; contentW: number; contentH: number };

function preload(letter: string | undefined): void {
  if (!letter) return;
  for (const file of ['ink.png', 'region.png']) {
    const img = new Image();
    img.src = assetUrl(letter, file);
  }
}

const AUTOSAVE_MS = 800;

function queuePersistLetter(painter: Painter, letter: Letter): Promise<void> {
  const history = painter.exportHistory();
  const historyJson = history.length > 0 ? JSON.stringify(history) : null;
  const snapshotPromise = Promise.all([painter.exportPaintBlob(), painter.exportBaseBlob()]).then(
    ([paint, base]) => ({ paint, historyJson, base }),
  );
  return queueLetterPersist(letter, snapshotPromise);
}

export default function App() {
  const stageRef = useRef<HTMLElement | null>(null);
  const pagerRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const painterRef = useRef<Painter | null>(null);
  const letterRef = useRef<Letter>('A');
  /** Letra cujos pixels estão na camada de cor (só muda após loadLetter commitar). */
  const canvasLetterRef = useRef<Letter>('A');
  const loadGenRef = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const scheduleSaveRef = useRef<() => void>(() => {});

  const [screen, setScreen] = useState<Screen>('studio');
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [painted, setPainted] = useState<Set<string>>(new Set());

  const [index, setIndex] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const onHistoryChange = useCallback((state: HistoryState) => {
    setCanUndo(state.canUndo);
    setCanRedo(state.canRedo);
  }, []);

  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [sizeIndex, setSizeIndex] = useState<SizeIndex>(1);
  const [painterReady, setPainterReady] = useState(false);
  const [sheetSize, setSheetSize] = useState<SheetSize | null>(null);
  const [zoomScale, setZoomScale] = useState(1);

  const letter = LETTERS[index]!;
  letterRef.current = letter;

  const refreshPainted = useCallback(async () => {
    setPainted(await paintedLetters());
  }, []);

  const cancelSaveTimer = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const flushSave = useCallback(async () => {
    cancelSaveTimer();
    const painter = painterRef.current;
    if (!painter) return;
    const key = canvasLetterRef.current;
    await queuePersistLetter(painter, key);
    await refreshPainted();
  }, [cancelSaveTimer, refreshPainted]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void flushSave();
    }, AUTOSAVE_MS);
  }, [flushSave]);

  scheduleSaveRef.current = scheduleSave;

  const cancelStroke = useCallback(() => {
    painterRef.current?.cancelStroke();
  }, []);

  const onZoomScaleChange = useCallback((scale: number) => {
    setZoomScale((prev) => (Math.abs(prev - scale) < 0.004 ? prev : scale));
  }, []);

  const { reset: resetZoom, zoomIn, zoomOut } = usePinchZoom(
    stageRef,
    sheetRef,
    cancelStroke,
    onZoomScaleChange,
  );

  useEffect(() => {
    void requestPersistentStorage();
    void refreshPainted();
  }, [refreshPainted]);

  useEffect(() => {
    const flush = () => void flushSave();
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [flushSave]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const painter = new Painter(
      sheet,
      {
        onHistoryChange,
        onPaintDirty: () => scheduleSaveRef.current(),
      },
      { tool, color, sizeIndex },
    );
    painterRef.current = painter;
    setPainterReady(true);

    return () => {
      painter.destroy();
      painterRef.current = null;
      setPainterReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const pager = pagerRef.current;
    if (!stage || !pager) return;

    const fit = () => {
      const style = getComputedStyle(stage);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

      const pagerOffset =
        getComputedStyle(pager).position === 'absolute'
          ? 0
          : pager.offsetHeight + (parseFloat(style.rowGap) || 0);

      const width = stage.clientWidth - padX;
      const height = stage.clientHeight - padY - pagerOffset;
      if (width <= 0 || height <= 0) return;

      const scale = Math.min(width / CANVAS_W, height / CANVAS_H);
      const contentW = Math.floor(CANVAS_W * scale);
      const contentH = Math.floor(CANVAS_H * scale);
      const desktop = window.matchMedia('(min-width: 760px)').matches;
      setSheetSize(
        desktop
          ? { w: Math.floor(width), h: Math.floor(height), contentW, contentH }
          : { w: contentW, h: contentH, contentW, contentH },
      );
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    const mq = window.matchMedia('(min-width: 760px)');
    const onMq = () => fit();
    mq.addEventListener('change', onMq);
    return () => {
      observer.disconnect();
      mq.removeEventListener('change', onMq);
    };
  }, []);

  useEffect(() => {
    painterRef.current?.setTool({ tool, color, sizeIndex });
  }, [tool, color, sizeIndex]);

  useEffect(() => {
    const painter = painterRef.current;
    if (!painter || !painterReady) return;

    const gen = ++loadGenRef.current;
    setCanUndo(false);
    setCanRedo(false);
    void (async () => {
      cancelSaveTimer();

      const { outgoing, token } = painter.hold(letter);
      if (outgoing) {
        await queuePersistLetter(painter, outgoing as Letter);
        await refreshPainted();
      }

      const { sessionRestored } = await painter.loadLetter(letter, token);
      if (gen !== loadGenRef.current || painter.getSettledLetter() !== letter) return;

      canvasLetterRef.current = letter;
      if (!sessionRestored) {
        const historyBlob = await getHistory(letter);
        const baseBlob = await getBase(letter);
        const paintBlob = await getPaint(letter);

        if (historyBlob) {
          const saved = parseSavedHistory(await historyBlob.text());
          if (baseBlob) await painter.restoreBase(baseBlob, token);
          if (gen !== loadGenRef.current || painter.getSettledLetter() !== letter) return;
          painter.restoreHistory(saved, token);
        } else if (paintBlob) {
          await painter.restoreBase(paintBlob, token);
        }
      }

      preload(LETTERS[(index + 1) % LETTERS.length]);
      preload(LETTERS[(index - 1 + LETTERS.length) % LETTERS.length]);
    })();
  }, [letter, index, painterReady, cancelSaveTimer, refreshPainted]);

  const openGrid = useCallback(() => {
    void flushSave().then(() => setScreen('grid'));
  }, [flushSave]);

  const pickLetter = useCallback((picked: Letter) => {
    const next = LETTERS.indexOf(picked);
    if (next >= 0) setIndex(next);
    setScreen('studio');
  }, []);

  const go = useCallback((delta: number) => {
    setIndex((current) => (current + delta + LETTERS.length) % LETTERS.length);
  }, []);

  const undo = useCallback(() => {
    painterRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    painterRef.current?.redo();
  }, []);

  const clearLetter = useCallback(
    (target?: Letter) => {
      const key = target ?? letterRef.current;
      const painter = painterRef.current;
      if (key === letterRef.current) painter?.clear();
      else painter?.discardSession(key);
      void (async () => {
        await queuePaintDelete(key);
        await refreshPainted();
      })();
    },
    [refreshPainted],
  );

  const clearAll = useCallback(() => {
    setConfirmClearAll(false);
    const painter = painterRef.current;
    painter?.clear();
    painter?.discardAllSessions();
    void (async () => {
      await queueDeleteAllPaint();
      await refreshPainted();
    })();
  }, [refreshPainted]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (meta && key === 'z' && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }
      if (meta && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (meta && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === '0') resetZoom();
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, redo, resetZoom, undo]);

  return (
    <div className="app">
      <p className="letter-status" role="status" aria-live="polite">
        {letter}
      </p>

      <main className="stage" ref={stageRef}>
        {Math.abs(zoomScale - 1) > 0.01 ? (
          <span className="zoom-pill" role="status" aria-live="polite">
            {Math.round(zoomScale * 100)}%
          </span>
        ) : null}
        <div className="sheet-wrap">
          <div
            className="sheet"
            ref={sheetRef}
            data-letter={letter}
            style={
              sheetSize
                ? {
                    width: sheetSize.w,
                    height: sheetSize.h,
                    ['--sheet-content-w' as string]: `${sheetSize.contentW}px`,
                    ['--sheet-content-h' as string]: `${sheetSize.contentH}px`,
                  }
                : undefined
            }
          />
        </div>

        <nav className="pager" ref={pagerRef} aria-label="Trocar de letra">
          <button
            className="btn nav"
            onClick={() => go(-1)}
            aria-label="Letra anterior"
          >
            <Arrow direction="left" />
          </button>

          <button
            className="btn nav"
            onClick={() => go(1)}
            aria-label="Próxima letra"
          >
            <Arrow direction="right" />
          </button>
        </nav>
      </main>

      <Dock
        tool={tool}
        color={color}
        sizeIndex={sizeIndex}
        canUndo={canUndo}
        canRedo={canRedo}
        onTool={setTool}
        onColor={setColor}
        onSize={setSizeIndex}
        onUndo={undo}
        onRedo={redo}
        onOpenGrid={openGrid}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onClearLetter={() => clearLetter()}
      />

      {confirmClearAll ? (
        <Confirm
          title="Limpar tudo?"
          message="Apaga a pintura de todas as 26 letras. Não dá para desfazer depois de fechar o aviso."
          confirmLabel="Limpar tudo"
          onCancel={() => setConfirmClearAll(false)}
          onConfirm={clearAll}
        />
      ) : null}

      {screen === 'grid' ? (
        <LetterGrid
          current={letter}
          painted={painted}
          onPick={pickLetter}
          onClose={() => setScreen('studio')}
          onClearLetter={clearLetter}
          onClearAll={() => setConfirmClearAll(true)}
        />
      ) : null}
    </div>
  );
}

function Arrow({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d={direction === 'left' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}