export const TOOLS = ['brush', 'crayon', 'eraser', 'bucket'] as const;
export type Tool = (typeof TOOLS)[number];

export const SIZE_LABELS = ['pequeno', 'médio', 'grande'] as const;
export type SizeIndex = 0 | 1 | 2;

/** Espessura em píxeis do canvas lógico (2048 × 1562). Ver D7. */
const SIZE_PX: Record<Tool, readonly [number, number, number]> = {
  brush: [30, 58, 100],
  crayon: [36, 68, 116],
  eraser: [80, 150, 240],
  bucket: [0, 0, 0],
};

export function resolveSize(tool: Tool, index: SizeIndex): number {
  return SIZE_PX[tool][index];
}

/** O balde não tem espessura. */
export function toolUsesSize(tool: Tool): boolean {
  return tool !== 'bucket';
}
