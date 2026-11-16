import type { Point } from './geometry';

export type SavedStroke = {
  kind: 'stroke';
  tool: 'brush' | 'crayon';
  color: string;
  size: number;
  pts: Point[];
};

export type SavedErase = { kind: 'erase'; size: number; pts: Point[] };

export type SavedFill = { kind: 'fill'; color: string; region: number };

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
      out.push({ kind: 'fill', color: row.color, region: row.region });
    }
  }
  return out;
}