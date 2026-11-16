import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import {
  TOOLS,
  dockSizeDotPx,
  resolveSize,
  toolUsesSize,
  type Tool,
} from '../canvas/tools';
import { PALETTE } from '../data/palette';

const TOOL_LABELS: Record<Tool, string> = {
  brush: 'Pincel',
  crayon: 'Giz de cera',
  eraser: 'Borracha',
  bucket: 'Balde de tinta',
  move: 'Mover',
};

type Props = {
  tool: Tool;
  color: string;
  sizeT: number;
  canUndo: boolean;
  canRedo: boolean;
  onTool: (tool: Tool) => void;
  onColor: (hex: string) => void;
  onSizeT: (value: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenGrid: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onClearLetter: () => void;
};

export function Dock({
  tool,
  color,
  sizeT,
  canUndo,
  canRedo,
  onTool,
  onColor,
  onSizeT,
  onUndo,
  onRedo,
  onOpenGrid,
  onZoomIn,
  onZoomOut,
  onClearLetter,
}: Props) {
  const stillUsesSize = toolUsesSize(tool);
  const controlsRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const paintRef = useRef<HTMLDivElement>(null);
  const sizeAnchorRef = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const popoverId = useId();
  const previewTool = stillUsesSize ? tool : 'brush';
  const dotPx = dockSizeDotPx(sizeT, previewTool);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    const actions = actionsRef.current;
    const paint = paintRef.current;
    if (!controls || !actions || !paint) return;

    const measure = () => {
      if (window.matchMedia('(max-width: 759px)').matches) {
        setStacked(true);
        return;
      }
      const firstAction = actions.querySelector<HTMLElement>('.tool');
      const firstPaint = paint.querySelector<HTMLElement>('.tool');
      if (!firstAction || !firstPaint) {
        setStacked(false);
        return;
      }
      setStacked(Math.abs(firstAction.offsetTop - firstPaint.offsetTop) > 4);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    observer.observe(actions);
    observer.observe(paint);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSizeOpen(false);
  }, [tool]);

  useEffect(() => {
    if (!sizeOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || sizeAnchorRef.current?.contains(target)) return;
      setSizeOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [sizeOpen]);

  const pickTool = (item: Tool) => {
    setSizeOpen(false);
    onTool(item);
  };

  return (
    <footer className="dock">
      <div className="dock__tools">
        <div
          ref={controlsRef}
          className={`dock__controls${stacked ? ' is-stacked' : ' is-inline'}`}
        >
          <div ref={paintRef} className="dock__block dock__block--paint">
            <div className="tools" role="group" aria-label="Ferramentas">
              {TOOLS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`tool${item === tool ? ' is-active' : ''}`}
                  aria-label={TOOL_LABELS[item]}
                  aria-pressed={item === tool}
                  onClick={() => pickTool(item)}
                >
                  <ToolIcon tool={item} />
                </button>
              ))}
            </div>

            <div ref={sizeAnchorRef} className="dock__size-anchor">
              <button
                type="button"
                className={`tool tool--size${sizeOpen ? ' is-active' : ''}`}
                aria-label="Tamanho do traço"
                aria-expanded={sizeOpen}
                aria-controls={sizeOpen ? popoverId : undefined}
                disabled={!stillUsesSize}
                onClick={() => setSizeOpen((open) => !open)}
              >
                <SizeIcon dotPx={dotPx} />
              </button>
              {sizeOpen && stillUsesSize ? (
                <div
                  id={popoverId}
                  className="size-popover"
                  role="dialog"
                  aria-label="Espessura do traço"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="size-popover__wedge">
                    <svg className="size-popover__track" viewBox="0 0 200 40" aria-hidden="true">
                      <polygon points="8,36 192,6 192,36" fill="currentColor" opacity="0.14" />
                    </svg>
                    <input
                      type="range"
                      className="size-popover__range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(sizeT * 100)}
                      aria-valuemin={resolveSize(previewTool, 0)}
                      aria-valuemax={resolveSize(previewTool, 1)}
                      aria-valuenow={resolveSize(previewTool, sizeT)}
                      aria-valuetext={`${resolveSize(previewTool, sizeT)} pixels`}
                      onChange={(event) => onSizeT(Number(event.target.value) / 100)}
                    />
                    <span
                      className="size-popover__preview"
                      style={{
                        width: 8 + sizeT * 18,
                        height: 8 + sizeT * 18,
                        left: `${sizeT * 100}%`,
                      }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <span className="dock__sep dock__sep--v" aria-hidden="true" />

          <div ref={actionsRef} className="dock__block dock__block--actions">
            <div className="dock__actions" role="group" aria-label="Ações">
              <button type="button" className="tool tool--meta" onClick={onOpenGrid} aria-label="Grade de letras">
                <GridIcon />
              </button>
              <button
                type="button"
                className="tool tool--meta"
                onClick={onUndo}
                disabled={!canUndo}
                aria-label="Desfazer"
              >
                <UndoIcon />
              </button>
              <button
                type="button"
                className="tool tool--meta"
                onClick={onRedo}
                disabled={!canRedo}
                aria-label="Refazer"
              >
                <RedoIcon />
              </button>
              <button type="button" className="tool tool--meta" onClick={onZoomIn} aria-label="Zoom mais">
                <ZoomInIcon />
              </button>
              <button type="button" className="tool tool--meta" onClick={onZoomOut} aria-label="Zoom menos">
                <ZoomOutIcon />
              </button>
              <button type="button" className="tool tool--meta" onClick={onClearLetter} aria-label="Limpar letra atual">
                <ClearLetterIcon />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="dock__colors">
        <div className="palette" role="group" aria-label="Cores">
          {PALETTE.map((swatch) => (
            <button
              key={swatch.hex}
              type="button"
              className={`swatch${swatch.hex === color ? ' is-active' : ''}`}
              style={{ background: swatch.hex }}
              aria-label={`Cor ${swatch.name}`}
              aria-pressed={swatch.hex === color}
              onClick={() => onColor(swatch.hex)}
            />
          ))}
        </div>
      </div>
    </footer>
  );
}

function SizeIcon({ dotPx }: { dotPx: number }) {
  return (
    <span
      className="size-icon"
      style={{ width: dotPx, height: dotPx }}
      aria-hidden="true"
    />
  );
}

/**
 * Ícones em 24 px com o mesmo traço 1,9 do balde.
 * Pincel e borracha vêm do Bootstrap Icons (MIT) e do Lucide (ISC); o giz de
 * cera é desenhado aqui — nenhuma biblioteca livre tem um giz que se leia a 23 px.
 */
function ToolIcon({ tool }: { tool: Tool }) {
  if (tool === 'brush') {
    return (
      <svg viewBox="0 0 16 16" width="27" height="27" fill="currentColor" aria-hidden="true">
        <path d="M15.825.12a.5.5 0 0 1 .132.584c-1.53 3.43-4.743 8.17-7.095 10.64a6.1 6.1 0 0 1-2.373 1.534c-.018.227-.06.538-.16.868-.201.659-.667 1.479-1.708 1.74a8.1 8.1 0 0 1-3.078.132 4 4 0 0 1-.562-.135 1.4 1.4 0 0 1-.466-.247.7.7 0 0 1-.204-.288.62.62 0 0 1 .004-.443c.095-.245.316-.38.461-.452.394-.197.625-.453.867-.826.095-.144.184-.297.287-.472l.117-.198c.151-.255.326-.54.546-.848.528-.739 1.201-.925 1.746-.896q.19.012.348.048c.062-.172.142-.38.238-.608.261-.619.658-1.419 1.187-2.069 2.176-2.67 6.18-6.206 9.117-8.104a.5.5 0 0 1 .596.04M4.705 11.912a1.2 1.2 0 0 0-.419-.1c-.246-.013-.573.05-.879.479-.197.275-.355.532-.5.777l-.105.177c-.106.181-.213.362-.32.528a3.4 3.4 0 0 1-.76.861c.69.112 1.736.111 2.657-.12.559-.139.843-.569.993-1.06a3 3 0 0 0 .126-.75zm1.44.026c.12-.04.277-.1.458-.183a5.1 5.1 0 0 0 1.535-1.1c1.9-1.996 4.412-5.57 6.052-8.631-2.59 1.927-5.566 4.66-7.302 6.792-.442.543-.795 1.243-1.042 1.826-.121.288-.214.54-.275.72v.001l.575.575zm-4.973 3.04.007-.005zm3.582-3.043.002.001h-.002z" />
      </svg>
    );
  }

  if (tool === 'crayon') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="27"
        height="27"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3.2 8.4h10.2l6.2 3.1a1.1 1.1 0 0 1 0 2l-6.2 3.1H3.2a1 1 0 0 1-1-1V9.4a1 1 0 0 1 1-1Z" />
        <path d="M13.4 8.4v8.2" />
        <path d="M16.6 10v5" />
      </svg>
    );
  }

  if (tool === 'eraser') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="27"
        height="27"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" />
        <path d="m5.082 11.09 8.828 8.828" />
      </svg>
    );
  }

  if (tool === 'move') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11" />
        <path d="M11 10.5V5.5a1.5 1.5 0 0 1 3 0V11" />
        <path d="M14 11V7.5a1.5 1.5 0 0 1 3 0V13" />
        <path d="M8 11.5c0-1.2-.9-2-2-1.6-.8.3-1.2 1.1-1 1.9l1.2 4.2A4 4 0 0 0 10 19.5h4.2a3.5 3.5 0 0 0 3.3-2.3l.8-2.2" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width="27"
      height="27"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.2 4.6 3.1 11.7a1.6 1.6 0 0 0 0 2.2l5 5a1.6 1.6 0 0 0 2.2 0l7.1-7.1L10.2 4.6Z" />
      <path d="M8.4 6.4 6.1 4.1" strokeLinecap="round" />
      <path
        d="M19.6 13.6c1.2 1.7 1.9 2.9 1.9 3.6a1.9 1.9 0 0 1-3.8 0c0-.7.7-1.9 1.9-3.6Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" strokeLinecap="round" />
      <path d="M11 8.5v5M8.5 11h5" strokeLinecap="round" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" strokeLinecap="round" />
      <path d="M8.5 11h5" strokeLinecap="round" />
    </svg>
  );
}

function ClearLetterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M6 7h12" strokeLinecap="round" />
      <path d="M9 7V5h6v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 7l.8 12.2h6.4L16 7" strokeLinejoin="round" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: 'scaleX(-1)' }}
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
    </svg>
  );
}