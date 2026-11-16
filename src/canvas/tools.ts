export const TOOLS = ['brush', 'crayon', 'bucket', 'eraser', 'move'] as const;
export type Tool = (typeof TOOLS)[number];

/** Traço médio do pincel (≈58 px com os mínimos atuais). */
export const DEFAULT_SIZE_T = 0.51;

/** Espessura mínima e máxima em píxeis do canvas lógico (2048 × 1562). Ver D7. */
const SIZE_RANGE: Record<Tool, readonly [number, number] | null> = {
  brush: [14, 100],
  crayon: [18, 116],
  eraser: [40, 240],
  bucket: null,
  move: null,
};

export function resolveSize(tool: Tool, sizeT: number): number {
  const range = SIZE_RANGE[tool];
  if (!range) return 0;
  const t = clamp01(sizeT);
  return Math.round(range[0] + t * (range[1] - range[0]));
}

/** Diâmetro do ponto no botão do dock (não é o tamanho do traço no canvas). */
export function dockSizeDotPx(sizeT: number, _tool: Tool): number {
  const t = clamp01(sizeT);
  const minDot = 5;
  const maxDot = 18;
  return Math.round(minDot + t * (maxDot - minDot));
}

/** O balde e o mover não têm espessura. */
export function toolUsesSize(tool: Tool): boolean {
  return SIZE_RANGE[tool] !== null;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}