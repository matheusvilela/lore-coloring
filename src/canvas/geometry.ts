export type Point = { x: number; y: number };

export const mid = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/**
 * Traça o caminho suavizado de uma sequência de pontos (quadráticas por pontos médios).
 * Usado tanto no traço ao vivo quanto no replay do undo, para que os dois nunca difiram.
 */
export function traceStroke(ctx: CanvasRenderingContext2D, pts: readonly Point[]): void {
  ctx.beginPath();
  if (pts.length === 0) return;

  if (pts.length === 1) {
    const p = pts[0];
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y);
    return;
  }

  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }

  for (let i = 1; i < pts.length - 1; i++) {
    const m = mid(pts[i], pts[i + 1]);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}
