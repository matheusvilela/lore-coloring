import type { Point } from './geometry';

export type SavedStroke = {
  kind: 'stroke';
  tool: 'brush' | 'crayon';
  color: string;
  size: number;
  pts: Point[];
};

export type SavedErase = { kind: 'erase'; size: number; pts: Point[] };

export type SavedFill = {
  kind: 'fill';
  color: string;
  region: number;
  /**
   * Toque em píxeis da pintura. Ausente em saves antigos: o balde preenche
   * a região inteira, como antes dos traços virarem parede.
   */
  at?: Point;
};

export type SavedCommand = SavedStroke | SavedErase | SavedFill;

export function parseSavedHistory(json: string): SavedCommand[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) return [];
  const out: SavedCommand[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.kind === 'stroke' && (row.tool === 'brush' || row.tool === 'crayon')) {
      if (typeof row.color !== 'string' || typeof row.size !== 'number' || !Array.isArray(row.pts)) continue;
      out.push({
        kind: 'stroke',
        tool: row.tool,
        color: row.color,
        size: row.size,
        pts: row.pts as Point[],
      });
    } else if (row.kind === 'erase') {
      if (typeof row.size !== 'number' || !Array.isArray(row.pts)) continue;
      out.push({ kind: 'erase', size: row.size, pts: row.pts as Point[] });
    } else if (row.kind === 'fill') {
      if (typeof row.color !== 'string' || typeof row.region !== 'number') continue;
      const at = parsePoint(row.at);
      out.push(
        at
          ? { kind: 'fill', color: row.color, region: row.region, at }
          : { kind: 'fill', color: row.color, region: row.region },
      );
    }
  }
  return out;
}

function parsePoint(value: unknown): Point | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const point = value as Record<string, unknown>;
  if (typeof point.x !== 'number' || typeof point.y !== 'number') return undefined;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  return { x: point.x, y: point.y };
}