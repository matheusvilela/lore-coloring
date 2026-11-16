import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CANVAS_H, CANVAS_W, Painter } from './canvas/Painter';
import type { SizeIndex, Tool } from './canvas/tools';
import { usePinchZoom } from './canvas/zoom';
import { Dock } from './components/Dock';
import { LETTERS, assetUrl } from './data/letters';
import { DEFAULT_COLOR } from './data/palette';

type Size = { w: number; h: number };

function preload(letter: string | undefined): void {
  if (!letter) return;
  for (const file of ['ink.png', 'region.png']) {
    const img = new Image();
    img.src = assetUrl(letter, file);
  }
}

export default function App() {
  const stageRef = useRef<HTMLElement | null>(null);
  const pagerRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const painterRef = useRef<Painter | null>(null);

  const [index, setIndex] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [sizeIndex, setSizeIndex] = useState<SizeIndex>(1);

  const letter = LETTERS[index];

  const cancelStroke = useCallback(() => {
    painterRef.current?.cancelStroke();
  }, []);

  const { reset: resetZoom } = usePinchZoom(stageRef, sheetRef, cancelStroke);

  // o motor vive fora do React; só recriamos se o container mudar
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const painter = new Painter(sheet, { onHistoryChange: setCanUndo }, { tool, color, sizeIndex });
    painterRef.current = painter;

    return () => {
      painter.destroy();
      painterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ajusta a folha ao espaço disponível, preservando a proporção do canvas
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const pager = pagerRef.current;
    if (!stage || !pager) return;

    const fit = () => {
      // clientWidth/Height já excluem borda, mas não o padding: nas telas
      // largas ele reserva a canaleta das setas e precisa sair da conta.
      const style = getComputedStyle(stage);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

      // no celular as setas ficam numa faixa abaixo da folha e comem altura;
      // nas telas largas elas vão para as canaletas (position: absolute) e não custam nada
      const pagerOffset =
        getComputedStyle(pager).position === 'absolute'
          ? 0
          : pager.offsetHeight + (parseFloat(style.rowGap) || 0);

      const width = stage.clientWidth - padX;
      const height = stage.clientHeight - padY - pagerOffset;
      if (width <= 0 || height <= 0) return;

      const scale = Math.min(width / CANVAS_W, height / CANVAS_H);
      setSize({ w: Math.floor(CANVAS_W * scale), h: Math.floor(CANVAS_H * scale) });
      // a geometria de encaixe mudou: um zoom antigo apontaria para o lugar errado
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
    if (!painter) return;

    setCanUndo(false);
    resetZoom();
    void painter.loadLetter(letter).then(() => {
      preload(LETTERS[index + 1]);
      preload(LETTERS[index - 1]);
    });
  }, [letter, index, resetZoom]);

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
      if (event.key === '0') resetZoom();
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, resetZoom, undo]);

  return (
    <div className="app">
      {/* a letra não aparece mais no layout, mas continua anunciada para leitores de tela */}
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
            disabled={index === 0}
            aria-label="Letra anterior"
          >
            <Arrow direction="left" />
          </button>

          <button
            className="btn nav"
            onClick={() => go(1)}
            disabled={index === LETTERS.length - 1}
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
      />
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
