import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CANVAS_H, CANVAS_W, Painter } from './canvas/Painter';
import { LETTERS, assetUrl } from './data/letters';

type Size = { w: number; h: number };

function preload(letter: string | undefined): void {
  if (!letter) return;
  const img = new Image();
  img.src = assetUrl(letter, 'ink.png');
}

export default function App() {
  const stageRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const painterRef = useRef<Painter | null>(null);

  const [index, setIndex] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  const letter = LETTERS[index];

  // o motor vive fora do React; só recriamos se o container mudar
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const painter = new Painter(sheet, { onHistoryChange: setCanUndo });
    painterRef.current = painter;

    return () => {
      painter.destroy();
      painterRef.current = null;
    };
  }, []);

  // ajusta a folha ao espaço disponível, preservando a proporção do canvas
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const fit = () => {
      // clientWidth/Height já excluem borda; o padding tem de sair da conta,
      // senão a folha fica maior que a área útil e vaza pela direita.
      const style = getComputedStyle(stage);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const width = stage.clientWidth - padX;
      const height = stage.clientHeight - padY;
      if (width <= 0 || height <= 0) return;

      const scale = Math.min(width / CANVAS_W, height / CANVAS_H);
      setSize({ w: Math.floor(CANVAS_W * scale), h: Math.floor(CANVAS_H * scale) });
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const painter = painterRef.current;
    if (!painter) return;

    setCanUndo(false);
    void painter.loadLetter(letter).then(() => {
      preload(LETTERS[index + 1]);
      preload(LETTERS[index - 1]);
    });
  }, [letter, index]);

  const go = useCallback((delta: number) => {
    setIndex((current) => Math.min(LETTERS.length - 1, Math.max(0, current + delta)));
  }, []);

  const undo = useCallback(() => {
    painterRef.current?.undo();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, undo]);

  return (
    <div className="app">
      <main className="stage" ref={stageRef}>
        <div
          className="sheet"
          ref={sheetRef}
          style={{ width: size.w || undefined, height: size.h || undefined }}
        />
      </main>

      <nav className="bar">
        <button
          className="btn"
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label="Letra anterior"
        >
          <Arrow direction="left" />
        </button>

        <div className="letter" aria-live="polite">
          {letter}
        </div>

        <button
          className="btn"
          onClick={() => go(1)}
          disabled={index === LETTERS.length - 1}
          aria-label="Próxima letra"
        >
          <Arrow direction="right" />
        </button>

        <button
          className="btn btn--ghost"
          onClick={undo}
          disabled={!canUndo}
          aria-label="Desfazer"
        >
          <UndoIcon />
        </button>
      </nav>
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

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path
        d="M9 7 H6 M6 7 V4 M6 7 L9.5 10.5 M6 7 H14 A5 5 0 0 1 14 17 H10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
