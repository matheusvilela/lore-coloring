import { assetUrl } from '../data/letters';
import { traceStroke, type Point } from './geometry';

/** Resolução lógica fixa da camada de pintura. Ver D7 em docs/decisoes.md. */
export const CANVAS_W = 2048;
export const CANVAS_H = 1562;

export type Brush = { color: string; size: number };

type StrokeCommand = { kind: 'stroke'; brush: Brush; pts: Point[] };
type Command = StrokeCommand;

export type PainterEvents = {
  /** Chamado quando o histórico muda (habilita/desabilita o desfazer). */
  onHistoryChange?: (canUndo: boolean) => void;
};

export type PainterOptions = {
  /** Cor e espessura iniciais do pincel. */
  brush?: Brush;
};

/**
 * Motor de pintura.
 *
 * Três camadas empilhadas, de baixo para cima:
 *   1. paint  — pintura já confirmada (é a única que sobrevive ao undo/replay)
 *   2. wet    — traço em andamento (redesenhado a cada frame, descartado ao soltar)
 *   3. ink    — o traço da letra, sempre por cima e nunca alterado (D2)
 *
 * O desenho é imperativo e fica fora do ciclo de render do React (D1).
 */
export class Painter {
  private readonly sheet: HTMLElement;
  private readonly paint: HTMLCanvasElement;
  private readonly wet: HTMLCanvasElement;
  private readonly ink: HTMLCanvasElement;
  private readonly pctx: CanvasRenderingContext2D;
  private readonly wctx: CanvasRenderingContext2D;
  private readonly ictx: CanvasRenderingContext2D;
  private readonly events: PainterEvents;

  private commands: Command[] = [];
  private current: StrokeCommand | null = null;
  private brush: Brush;

  private activePointer: number | null = null;
  private frame = 0;
  private loadToken = 0;
  private destroyed = false;

  constructor(sheet: HTMLElement, events: PainterEvents = {}, options: PainterOptions = {}) {
    this.sheet = sheet;
    this.events = events;
    this.brush = options.brush ?? { color: '#D24545', size: 44 };

    this.paint = this.createLayer('layer layer--paint');
    this.wet = this.createLayer('layer layer--wet');
    this.ink = this.createLayer('layer layer--ink');

    this.pctx = get2d(this.paint);
    this.wctx = get2d(this.wet);
    this.ictx = get2d(this.ink);

    this.ink.addEventListener('pointerdown', this.onPointerDown);
    this.ink.addEventListener('pointermove', this.onPointerMove);
    this.ink.addEventListener('pointerup', this.onPointerUp);
    this.ink.addEventListener('pointercancel', this.onPointerUp);
    this.ink.addEventListener('contextmenu', prevent);
  }

  /* ---------- API pública ---------- */

  setBrush(brush: Partial<Brush>): void {
    this.brush = { ...this.brush, ...brush };
  }

  /** Carrega a arte da letra e limpa a pintura e o histórico. */
  async loadLetter(letter: string): Promise<void> {
    const token = ++this.loadToken;
    const img = new Image();
    img.src = assetUrl(letter, 'ink.png');
    await img.decode();
    if (this.destroyed || token !== this.loadToken) return;

    this.ictx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.ictx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
    this.reset();
  }

  undo(): boolean {
    if (this.commands.length === 0) return false;
    this.commands.pop();
    this.repaint();
    this.emitHistory();
    return true;
  }

  clear(): void {
    this.reset();
  }

  /** Há pintura na letra atual? (usado pela persistência da Etapa 4) */
  hasPaint(): boolean {
    return this.commands.length > 0;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.ink.removeEventListener('pointerdown', this.onPointerDown);
    this.ink.removeEventListener('pointermove', this.onPointerMove);
    this.ink.removeEventListener('pointerup', this.onPointerUp);
    this.ink.removeEventListener('pointercancel', this.onPointerUp);
    this.ink.removeEventListener('contextmenu', prevent);
    for (const c of [this.paint, this.wet, this.ink]) c.remove();
  }

  /* ---------- pintura ---------- */

  private createLayer(className: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    canvas.className = className;
    this.sheet.appendChild(canvas);
    return canvas;
  }

  private toLocal(event: PointerEvent): Point {
    const rect = this.ink.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }

  private strokeStyle(ctx: CanvasRenderingContext2D, brush: Brush): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = brush.color;
    ctx.fillStyle = brush.color;
    ctx.lineWidth = brush.size;
  }

  /** Redesenha só o traço em andamento na camada wet. */
  private renderWet(): void {
    this.wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (!this.current) return;
    this.strokeStyle(this.wctx, this.current.brush);
    traceStroke(this.wctx, this.current.pts);
    this.wctx.stroke();
  }

  private scheduleWet(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderWet();
    });
  }

  private paintCommand(ctx: CanvasRenderingContext2D, cmd: Command): void {
    if (cmd.kind !== 'stroke') return;
    this.strokeStyle(ctx, cmd.brush);
    traceStroke(ctx, cmd.pts);
    ctx.stroke();
  }

  private repaint(): void {
    this.pctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    for (const cmd of this.commands) this.paintCommand(this.pctx, cmd);
  }

  private reset(): void {
    this.commands = [];
    this.current = null;
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.pctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.emitHistory();
  }

  private emitHistory(): void {
    this.events.onHistoryChange?.(this.commands.length > 0);
  }

  /* ---------- eventos de ponteiro ---------- */

  private onPointerDown = (event: PointerEvent): void => {
    // um dedo por vez: o segundo ponteiro é ignorado (rejeição de palma)
    if (this.activePointer !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.preventDefault();
    this.activePointer = event.pointerId;
    this.ink.setPointerCapture(event.pointerId);

    this.current = { kind: 'stroke', brush: { ...this.brush }, pts: [this.toLocal(event)] };
    this.renderWet();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId || !this.current) return;
    event.preventDefault();

    // getCoalescedEvents entrega as amostras que o navegador agrupou no mesmo frame
    const coalesced = event.getCoalescedEvents?.();
    const samples = coalesced && coalesced.length > 0 ? coalesced : [event];
    for (const sample of samples) {
      const p = this.toLocal(sample);
      const last = this.current.pts[this.current.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) continue;
      this.current.pts.push(p);
    }
    this.scheduleWet();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId || !this.current) return;
    const stroke = this.current;

    this.activePointer = null;
    this.current = null;
    if (this.ink.hasPointerCapture(event.pointerId)) this.ink.releasePointerCapture(event.pointerId);

    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    this.commands.push(stroke);
    this.paintCommand(this.pctx, stroke);
    this.emitHistory();
  };
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');
  return ctx;
}

function prevent(event: Event): void {
  event.preventDefault();
}
