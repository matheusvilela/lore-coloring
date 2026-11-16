import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CANVAS_H, CANVAS_W, Painter } from './canvas/Painter';
import type { SizeIndex, Tool } from './canvas/tools';
import { usePinchZoom } from './canvas/zoom';
import { Confirm } from './components/Confirm';
import { Dock } from './components/Dock';
import { LetterGrid } from './components/LetterGrid';
import { LETTERS, assetUrl, type Letter } from './data/letters';
import { DEFAULT_COLOR } from './data/palette';
import {
  deleteAllPaint,
  deletePaint,
  getPaint,
  paintedLetters,
  putPaint,
  requestPersistentStorage,
} from './storage/db';

type Size = { w: number; h: number };
type Screen = 'studio' | 'grid';

function preload(letter: string | undefined): void {
  if (!letter) return;
  for (const file of ['ink.png', 'region.png']) {
    const img = new Image();
    img.src = assetUrl(letter, file);
  }
}

const AUTOSAVE_MS = 800;

export default function App() {
  const stageRef = useRef<HTMLElement | null>(null);
  const pagerRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const painterRef = useRef<Painter | null>(null);
  const letterRef = useRef<Letter>('A');
  const saveTimer = useRef<number | null>(null);
  const scheduleSaveRef = useRef<() => void>(() => {});

  const [screen, setScreen] = useState<Screen>('studio');
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [painted, setPainted] = useState<Set<string>>(new Set());

  const [index, setIndex] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [sizeIndex, setSizeIndex] = useState<SizeIndex>(1);
  const [painterReady, setPainterReady] = useState(false);

  const letter = LETTERS[index]!;
  letterRef.current = letter;

  const refreshPainted = useCallback(async () => {
    setPainted(await paintedLetters());
  }, []);

  const flushSave = useCallback(async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const painter = painterRef.current;
    if (!painter) return;
    const blob = await painter.exportPaintBlob();
    const key = letterRef.current;
    if (blob) await putPaint(key, blob);
    else await deletePaint(key);
    await refreshPainted();
  }, [refreshPainted]);

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

  const { reset: resetZoom } = usePinchZoom(stageRef, sheetRef, cancelStroke);

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
        onHistoryChange: setCanUndo,
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
      setSize({ w: Math.floor(CANVAS_W * scale), h: Math.floor(CANVAS_H * scale) });
      resetZoom();
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [resetZoom]);

  useEffect(() => {
    painterRef.current?.setTool({ tool, color, sizeIndex });
  }, [tool, color, sizeIndex]);

  useEffect(() => {
    const painter = painterRef.current;
    if (!painter || !painterReady) return;

    setCanUndo(false);
    resetZoom();
    void (async () => {
      await painter.loadLetter(letter);
      const saved = await getPaint(letter);
      if (saved) await painter.restorePaint(saved);
      preload(LETTERS[(index + 1) % LETTERS.length]);
      preload(LETTERS[(index - 1 + LETTERS.length) % LETTERS.length]);
    })();
  }, [letter, index, resetZoom, painterReady]);

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

  const clearLetter = useCallback(() => {
    painterRef.current?.clear();
    void (async () => {
      await deletePaint(letterRef.current);
      await refreshPainted();
    })();
  }, [refreshPainted]);

  const clearAll = useCallback(() => {
    setConfirmClearAll(false);
    painterRef.current?.clear();
    void (async () => {
      await deleteAllPaint();
      await refreshPainted();
    })();
  }, [refreshPainted]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === '0') resetZoom();
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, resetZoom, undo]);

  return (
    <div className="app">
      <p className="letter-status" role="status" aria-live="polite">
        {letter}
      </p>

      <main className="stage" ref={stageRef}>
        <div
          className="sheet-wrap"
          style={{ width: size.w || undefined, height: size.h || undefined }}
        >
          <div
            className="sheet"
            ref={sheetRef}
            data-letter={letter}
            style={{ width: size.w || undefined, height: size.h || undefined }}
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
        onTool={setTool}
        onColor={setColor}
        onSize={setSizeIndex}
        onUndo={undo}
        onOpenGrid={openGrid}
        onClearLetter={clearLetter}
        onClearAll={() => setConfirmClearAll(true)}
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