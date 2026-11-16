import { assetUrl } from '../data/letters';
import type { SavedCommand } from './history';
import { traceStroke, type Point } from './geometry';
import { grainPattern } from './texture';
import { DEFAULT_SIZE_T, resolveSize, type Tool } from './tools';

/** Resolução lógica fixa da camada de pintura. Ver D7 em docs/decisoes.md. */
export const CANVAS_W = 2048;
export const CANVAS_H = 1562;

/** `region.png` tem exatamente metade da resolução de pintura (D5). */
const REGION_W = CANVAS_W / 2;
const REGION_H = CANVAS_H / 2;

/** Id reservado para os píxeis de tinta no mapa de regiões. */
const INK_REGION = 0xffff;

export type ToolState = { tool: Tool; color: string; sizeT: number };

type StrokeCommand = {
  kind: 'stroke';
  tool: 'brush' | 'crayon';
  color: string;
  size: number;
  pts: Point[];
};
type EraseCommand = { kind: 'erase'; size: number; pts: Point[] };
type FillCommand = { kind: 'fill'; color: string; region: number };
type Command = StrokeCommand | EraseCommand | FillCommand;

type LetterSession = { commands: Command[]; redo: Command[]; base: ImageBitmap | null };

type Box = { x0: number; y0: number; x1: number; y1: number };

export type HistoryState = { canUndo: boolean; canRedo: boolean };

export type PainterEvents = {
  /** Chamado quando o histórico muda (habilita/desabilita desfazer e refazer). */
  onHistoryChange?: (state: HistoryState) => void;
  /** Eventos de domínio para o som futuro (D10). */
  onAction?: (action: 'stroke' | 'erase' | 'fill') => void;
  /** Camada de cor alterada (autosave). */
  onPaintDirty?: () => void;
};

/**
 * Motor de pintura.
 *
 * Três camadas empilhadas, de baixo para cima:
 *   1. paint  — pintura confirmada (única que sobrevive ao undo/replay)
 *   2. wet    — traço em andamento, redesenhado a cada frame
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
  private redoCommands: Command[] = [];
  /** Pintura legada (PNG sem histórico); não entra na pilha do desfazer. */
  private baseBitmap: ImageBitmap | null = null;
  private current: StrokeCommand | EraseCommand | null = null;

  private tool: Tool;
  private color: string;
  private size: number;

  /** Mapa de regiões do balde da letra atual (id por píxel; 0xffff = tinta). */
  private regionIds: Uint16Array | null = null;
  private regionBox: Array<Box | undefined> = [];
  /** Máscara recolorível de cada região já usada, em resolução de pintura. */
  private readonly fillTiles = new Map<number, { canvas: HTMLCanvasElement; x: number; y: number }>();
  private scratch: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;

  private activePointer: number | null = null;
  /**
   * Balde: o preenchimento só acontece ao soltar o dedo. Assim a pinça — que
   * começa com um dedo encostado na folha — cancela o toque em vez de pintar
   * uma região inteira sem querer.
   */
  private pendingFill: Point | null = null;
  private frame = 0;
  private loadToken = 0;
  private destroyed = false;

  /** Pilhas de desfazer/refazer por letra nesta visita (troca A→B→A). */
  private readonly sessions = new Map<string, LetterSession>();
  /** Letra cuja arte já terminou de carregar na tela. */
  private settledLetter: string | null = null;

  constructor(sheet: HTMLElement, events: PainterEvents = {}, initial?: ToolState) {
    this.sheet = sheet;
    this.events = events;
    this.tool = initial?.tool ?? 'brush';
    this.color = initial?.color ?? '#D24545';
    this.size = resolveSize(this.tool, initial?.sizeT ?? DEFAULT_SIZE_T);

    this.paint = this.createLayer('layer layer--paint');
    this.wet = this.createLayer('layer layer--wet');
    this.ink = this.createLayer('layer layer--ink');

    this.pctx = get2d(this.paint);
    this.wctx = get2d(this.wet);
    this.ictx = get2d(this.ink);

    this.sheet.dataset.tool = this.tool;

    this.sheet.addEventListener('pointerdown', this.onPointerDown);
    this.sheet.addEventListener('pointermove', this.onPointerMove);
    this.sheet.addEventListener('pointerup', this.onPointerUp);
    this.sheet.addEventListener('pointercancel', this.onPointerCancel);
    this.sheet.addEventListener('contextmenu', prevent);
  }

  /* ---------- API pública ---------- */

  setTool(state: Partial<ToolState>): void {
    if (state.tool !== undefined) this.tool = state.tool;
    if (state.color !== undefined) this.color = state.color;
    if (state.sizeT !== undefined) {
      this.size = resolveSize(this.tool, state.sizeT);
    }
    this.sheet.dataset.tool = this.tool;
  }

  /**
   * Antes de trocar de letra: estaciona o histórico da letra atual e invalida
   * carregamentos assíncronos em andamento. A camada de cor fica intacta para
   * exportação do PNG da letra que está saindo.
   */
  hold(_nextLetter: string): { outgoing: string | null; token: number } {
    this.commitInProgressGesture();
    const outgoing = this.settledLetter;
    if (outgoing !== null) {
      this.sessions.set(outgoing, {
        commands: this.commands,
        redo: this.redoCommands,
        base: this.baseBitmap,
      });
      this.commands = [];
      this.redoCommands = [];
      this.baseBitmap = null;
    }
    this.settledLetter = null;
    const token = ++this.loadToken;
    return { outgoing, token };
  }

  /** Letra cuja arte terminou de carregar na tela (ou `null` enquanto troca). */
  getSettledLetter(): string | null {
    return this.settledLetter;
  }

  /** Descarta o histórico estacionado de uma letra (ex.: limpar na grade). */
  discardSession(letter: string): void {
    const parked = this.sessions.get(letter);
    if (!parked) return;
    parked.base?.close();
    this.sessions.delete(letter);
  }

  discardAllSessions(): void {
    for (const letter of [...this.sessions.keys()]) this.discardSession(letter);
  }

  /** Carrega a arte da letra; restaura pilha estacionada se existir. */
  async loadLetter(letter: string, token: number): Promise<{ sessionRestored: boolean }> {
    const [inkImage, regionImage] = await Promise.all([
      loadImage(assetUrl(letter, 'ink.png')),
      loadImage(assetUrl(letter, 'region.png')),
    ]);
    if (this.destroyed || token !== this.loadToken) return { sessionRestored: false };

    this.ictx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.ictx.drawImage(inkImage, 0, 0, CANVAS_W, CANVAS_H);

    this.readRegions(regionImage);

    const sessionRestored = this.sessions.has(letter);
    if (sessionRestored) {
      const snap = this.sessions.get(letter)!;
      this.commands = snap.commands;
      this.redoCommands = snap.redo;
      this.baseBitmap = snap.base;
      this.sessions.delete(letter);
      this.current = null;
      if (this.frame) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      }
      this.wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      this.repaint();
      this.emitHistory();
    } else {
      this.reset();
    }

    this.settledLetter = letter;
    return { sessionRestored };
  }

  undo(): boolean {
    if (this.commands.length === 0) return false;
    const removed = this.commands.pop()!;
    this.redoCommands.push(removed);
    this.repaint();
    this.emitHistory();
    this.emitPaintDirty();
    return true;
  }

  redo(): boolean {
    if (this.redoCommands.length === 0) return false;
    const restored = this.redoCommands.pop()!;
    this.commands.push(restored);
    this.repaint();
    this.emitHistory();
    this.emitPaintDirty();
    return true;
  }

  /** Limpa a pintura da letra atual (o desfazer de tudo). */
  clear(): void {
    this.reset();
    this.emitPaintDirty();
  }

  /**
   * Aborta o traço em andamento sem entrar no histórico.
   * Usado quando o segundo dedo encosta na tela: o gesto vira pinça e o
   * risco acidental do primeiro dedo precisa desaparecer.
   */
  cancelStroke(): void {
    const id = this.activePointer;
    if (id === null) return;

    const inProgress = this.current;
    this.activePointer = null;
    this.current = null;
    this.pendingFill = null;
    if (this.sheet.hasPointerCapture(id)) this.sheet.releasePointerCapture(id);
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    // borracha em andamento altera a camada de cor direto; traço só vive na wet
    if (inProgress?.kind === 'erase') this.repaint();
    this.wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  }

  /** Há comandos na sessão (desfazer). */
  hasPaint(): boolean {
    return this.commands.length > 0;
  }

  /** Há pixels opacos na camada de cor (persistência / grade). */
  hasVisiblePaint(): boolean {
    return paintLayerHasPixels(this.pctx, CANVAS_W, CANVAS_H);
  }

  /** Restaura pintura legada (PNG sem histórico); desfazer fica desligado. */
  async restoreBase(blob: Blob, token: number): Promise<void> {
    if (this.destroyed || token !== this.loadToken) return;

    this.closeBase();
    this.commands = [];
    this.clearRedoStack();
    this.current = null;
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    const bitmap = await createImageBitmap(blob);
    if (this.destroyed || token !== this.loadToken) {
      bitmap.close();
      return;
    }
    this.baseBitmap = bitmap;
    this.repaint();
    this.emitHistory();
  }

  restoreHistory(saved: SavedCommand[], token: number): void {
    if (this.destroyed || token !== this.loadToken) return;
    this.clearRedoStack();
    this.commands = saved.map((cmd) => {
      if (cmd.kind === 'fill') return { kind: 'fill', color: cmd.color, region: cmd.region };
      return { ...cmd, pts: cmd.pts.map((p) => ({ ...p })) };
    }) as Command[];
    this.current = null;
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.repaint();
    this.emitHistory();
  }

  exportHistory(): SavedCommand[] {
    return this.commands.map((cmd) => {
      if (cmd.kind === 'fill') {
        return { kind: 'fill', color: cmd.color, region: cmd.region };
      }
      return { ...cmd, pts: cmd.pts.map((p) => ({ ...p })) };
    });
  }

  hasPersistedBase(): boolean {
    return this.baseBitmap !== null;
  }

  /** Exporta a camada de cor como PNG, ou `null` se estiver vazia. */
  exportPaintBlob(): Promise<Blob | null> {
    if (!this.hasVisiblePaint()) return Promise.resolve(null);
    const dataUrl = this.paint.toDataURL('image/png');
    return fetch(dataUrl).then((response) => response.blob());
  }

  exportBaseBlob(): Promise<Blob | null> {
    if (!this.baseBitmap) return Promise.resolve(null);
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(this.baseBitmap, 0, 0, CANVAS_W, CANVAS_H);
    const dataUrl = canvas.toDataURL('image/png');
    return fetch(dataUrl).then((response) => response.blob());
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.discardAllSessions();
    this.closeBase();
    this.clearRedoStack();
    this.sheet.removeEventListener('pointerdown', this.onPointerDown);
    this.sheet.removeEventListener('pointermove', this.onPointerMove);
    this.sheet.removeEventListener('pointerup', this.onPointerUp);
    this.sheet.removeEventListener('pointercancel', this.onPointerCancel);
    this.sheet.removeEventListener('contextmenu', prevent);
    for (const c of [this.paint, this.wet, this.ink]) c.remove();
  }

  /* ---------- camadas ---------- */

  private createLayer(className: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    canvas.className = className;
    this.sheet.appendChild(canvas);
    return canvas;
  }

  /* ---------- geometria ---------- */

  private toLocal(event: PointerEvent): Point {
    const rect = this.ink.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const scale = rect.width / CANVAS_W;
    return {
      x: clamp((event.clientX - rect.left) / scale, 0, CANVAS_W - 1),
      y: clamp((event.clientY - rect.top) / scale, 0, CANVAS_H - 1),
    };
  }

  /* ---------- pincel e giz ---------- */

  private drawStroke(ctx: CanvasRenderingContext2D, cmd: StrokeCommand): void {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.save();

    if (cmd.tool === 'crayon') {
      const pattern = grainPattern(ctx, cmd.color, cmd.size);
      ctx.strokeStyle = pattern ?? cmd.color;
      // duas passadas: a larga dá o corpo, a estreita concentra a cera
      ctx.lineWidth = cmd.size;
      ctx.globalAlpha = 0.72;
      traceStroke(ctx, cmd.pts);
      ctx.stroke();

      ctx.globalAlpha = 0.9;
      ctx.lineWidth = cmd.size * 0.66;
      traceStroke(ctx, cmd.pts);
      ctx.stroke();
    } else {
      ctx.strokeStyle = cmd.color;
      ctx.fillStyle = cmd.color;
      ctx.lineWidth = cmd.size;
      traceStroke(ctx, cmd.pts);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawErase(ctx: CanvasRenderingContext2D, cmd: EraseCommand): void {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = cmd.size;
    traceStroke(ctx, cmd.pts);
    ctx.stroke();
    ctx.restore();
  }

  /** Redesenha só o traço em andamento na camada wet. */
  private renderWet(): void {
    this.wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (this.current?.kind === 'stroke') this.drawStroke(this.wctx, this.current);
  }

  private scheduleWet(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderWet();
    });
  }

  /* ---------- balde ---------- */

  private readRegions(image: HTMLImageElement): void {
    const canvas = document.createElement('canvas');
    canvas.width = REGION_W;
    canvas.height = REGION_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(image, 0, 0, REGION_W, REGION_H);
    const { data } = ctx.getImageData(0, 0, REGION_W, REGION_H);

    const ids = new Uint16Array(REGION_W * REGION_H);
    const boxes: Array<Box | undefined> = [];

    for (let i = 0; i < ids.length; i++) {
      const o = i * 4;
      // alpha 0 = tinta (barreira); R+G = id da região
      const id = data[o + 3] === 0 ? INK_REGION : data[o] | (data[o + 1] << 8);
      ids[i] = id;
      if (id === INK_REGION) continue;

      const x = i % REGION_W;
      const y = (i / REGION_W) | 0;
      const box = boxes[id];
      if (!box) boxes[id] = { x0: x, y0: y, x1: x, y1: y };
      else {
        if (x < box.x0) box.x0 = x;
        if (x > box.x1) box.x1 = x;
        if (y < box.y0) box.y0 = y;
        if (y > box.y1) box.y1 = y;
      }
    }

    this.regionIds = ids;
    this.regionBox = boxes;
    this.fillTiles.clear();
  }

  private fillAt(point: Point): boolean {
    const ids = this.regionIds;
    if (!ids) return false;

    const rx = clamp(Math.floor(point.x / 2), 0, REGION_W - 1);
    const ry = clamp(Math.floor(point.y / 2), 0, REGION_H - 1);
    const region = ids[ry * REGION_W + rx];
    if (region === INK_REGION) return false; // tocou na linha preta

    const cmd: FillCommand = { kind: 'fill', color: this.color, region };
    this.appendCommand(cmd);
    this.applyFill(this.pctx, cmd);
    this.emitHistory();
    this.emitPaintDirty();
    this.events.onAction?.('fill');
    return true;
  }

  /**
   * Máscara da região em resolução de pintura (2× exato), com 1 píxel de
   * dilatação **para dentro da tinta**. Sem isso aparece uma costura branca
   * entre o preenchimento e o antialiasing do traço; como a tinta fica por
   * cima, a dilatação é invisível.
   */
  private fillTile(region: number): { canvas: HTMLCanvasElement; x: number; y: number } | null {
    const cached = this.fillTiles.get(region);
    if (cached) return cached;

    const ids = this.regionIds;
    const box = this.regionBox[region];
    if (!ids || !box) return null;

    const x0 = Math.max(0, box.x0 - 1);
    const y0 = Math.max(0, box.y0 - 1);
    const x1 = Math.min(REGION_W - 1, box.x1 + 1);
    const y1 = Math.min(REGION_H - 1, box.y1 + 1);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;

    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const img = ctx.createImageData(canvas.width, canvas.height);
    const d = img.data;

    for (let ry = 0; ry < h; ry++) {
      for (let rx = 0; rx < w; rx++) {
        const gi = (y0 + ry) * REGION_W + (x0 + rx);
        let inside = ids[gi] === region;

        if (!inside && ids[gi] === INK_REGION) {
          scan: for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = rx + dx;
              const ny = ry + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              if (ids[(y0 + ny) * REGION_W + (x0 + nx)] === region) {
                inside = true;
                break scan;
              }
            }
          }
        }
        if (!inside) continue;

        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const o = ((ry * 2 + sy) * canvas.width + (rx * 2 + sx)) * 4;
            d[o] = 255;
            d[o + 1] = 255;
            d[o + 2] = 255;
            d[o + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    const tile = { canvas, x: x0 * 2, y: y0 * 2 };
    this.fillTiles.set(region, tile);
    return tile;
  }

  private applyFill(ctx: CanvasRenderingContext2D, cmd: FillCommand): void {
    const tile = this.fillTile(cmd.region);
    if (!tile) return;

    const { width, height } = tile.canvas;
    if (!this.scratch || this.scratch.width !== width || this.scratch.height !== height) {
      this.scratch = document.createElement('canvas');
      this.scratch.width = width;
      this.scratch.height = height;
      this.scratchCtx = this.scratch.getContext('2d');
    }
    const sctx = this.scratchCtx;
    if (!sctx) return;

    sctx.clearRect(0, 0, width, height);
    sctx.drawImage(tile.canvas, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = cmd.color;
    sctx.fillRect(0, 0, width, height);
    sctx.globalCompositeOperation = 'source-over';

    ctx.drawImage(this.scratch, 0, 0, width, height, tile.x, tile.y, width, height);
  }

  /* ---------- histórico ---------- */

  private paintCommand(ctx: CanvasRenderingContext2D, cmd: Command): void {
    if (cmd.kind === 'stroke') this.drawStroke(ctx, cmd);
    else if (cmd.kind === 'erase') this.drawErase(ctx, cmd);
    else this.applyFill(ctx, cmd);
  }

  private repaint(): void {
    this.pctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (this.baseBitmap) this.pctx.drawImage(this.baseBitmap, 0, 0, CANVAS_W, CANVAS_H);
    for (const cmd of this.commands) this.paintCommand(this.pctx, cmd);
  }

  private closeBase(): void {
    this.baseBitmap?.close();
    this.baseBitmap = null;
  }

  private reset(): void {
    this.closeBase();
    this.clearRedoStack();
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
    this.events.onHistoryChange?.({
      canUndo: this.commands.length > 0,
      canRedo: this.redoCommands.length > 0,
    });
  }

  private clearRedoStack(): void {
    this.redoCommands = [];
  }

  private appendCommand(command: Command): void {
    this.clearRedoStack();
    this.commands.push(command);
  }

  private emitPaintDirty(): void {
    this.events.onPaintDirty?.();
  }

  /** Finaliza traço/borracha ao sair da letra; balde pendente é cancelado. */
  private commitInProgressGesture(): void {
    if (this.pendingFill) {
      this.pendingFill = null;
      if (this.activePointer !== null && this.sheet.hasPointerCapture(this.activePointer)) {
        this.sheet.releasePointerCapture(this.activePointer);
      }
      this.activePointer = null;
      return;
    }

    if (!this.current) {
      if (this.activePointer !== null && this.sheet.hasPointerCapture(this.activePointer)) {
        this.sheet.releasePointerCapture(this.activePointer);
      }
      this.activePointer = null;
      return;
    }

    const command = this.current;
    const captureId = this.activePointer;
    this.activePointer = null;
    this.current = null;
    if (captureId !== null && this.sheet.hasPointerCapture(captureId)) {
      this.sheet.releasePointerCapture(captureId);
    }
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    this.appendCommand(command);
    if (command.kind === 'erase') this.repaint();
    else this.paintCommand(this.pctx, command);
    this.emitHistory();
    this.emitPaintDirty();
    this.events.onAction?.(command.kind);
  }

  /* ---------- eventos de ponteiro ---------- */

  private onPointerDown = (event: PointerEvent): void => {
    if (this.tool === 'move') return;

    // um dedo por vez: o segundo ponteiro é ignorado (rejeição de palma)
    if (this.activePointer !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.preventDefault();
    const point = this.toLocal(event);

    if (this.tool === 'bucket') {
      // pinta ao soltar: se um segundo dedo chegar, vira pinça e o toque é cancelado
      this.activePointer = event.pointerId;
      this.sheet.setPointerCapture(event.pointerId);
      this.pendingFill = point;
      return;
    }

    this.activePointer = event.pointerId;
    this.sheet.setPointerCapture(event.pointerId);

    if (this.tool === 'eraser') {
      this.current = { kind: 'erase', size: this.size, pts: [point] };
      this.drawErase(this.pctx, this.current);
      return;
    }

    this.current = {
      kind: 'stroke',
      tool: this.tool,
      color: this.color,
      size: this.size,
      pts: [point],
    };
    this.renderWet();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId || !this.current) return;
    event.preventDefault();

    // getCoalescedEvents entrega as amostras que o navegador agrupou no mesmo frame
    const coalesced = event.getCoalescedEvents?.();
    const samples = coalesced && coalesced.length > 0 ? coalesced : [event];
    const pts = this.current.pts;

    for (const sample of samples) {
      const p = this.toLocal(sample);
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) continue;
      pts.push(p);
    }

    if (this.current.kind === 'erase') {
      // a borracha age direto na camada de pintura; ao soltar, o replay
      // recompõe o estado exato (o preview ao vivo é só aproximação)
      this.drawErase(this.pctx, this.current);
    } else {
      this.scheduleWet();
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId) return;

    if (this.pendingFill) {
      const point = this.pendingFill;
      this.pendingFill = null;
      this.activePointer = null;
      if (this.sheet.hasPointerCapture(event.pointerId)) this.sheet.releasePointerCapture(event.pointerId);
      this.fillAt(point);
      return;
    }

    if (!this.current) {
      this.activePointer = null;
      return;
    }
    const command = this.current;

    this.activePointer = null;
    this.current = null;
    if (this.sheet.hasPointerCapture(event.pointerId)) this.sheet.releasePointerCapture(event.pointerId);

    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    this.appendCommand(command);
    if (command.kind === 'erase') this.repaint();
    else this.paintCommand(this.pctx, command);

    this.emitHistory();
    this.emitPaintDirty();
    this.events.onAction?.(command.kind);
  };

  /** Cancelamento (troca de orientação, gesto do sistema): balde pendente não pinta. */
  private onPointerCancel = (event: PointerEvent): void => {
    if (this.activePointer !== event.pointerId) return;
    if (this.pendingFill) {
      this.pendingFill = null;
      this.activePointer = null;
      if (this.sheet.hasPointerCapture(event.pointerId)) this.sheet.releasePointerCapture(event.pointerId);
      return;
    }
    this.onPointerUp(event);
  };
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível');
  return ctx;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function prevent(event: Event): void {
  event.preventDefault();
}

function paintLayerHasPixels(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > 0) return true;
  }
  return false;
}
