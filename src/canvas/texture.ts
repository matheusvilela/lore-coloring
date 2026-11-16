/**
 * Textura do giz de cera.
 *
 * A pintura é reproduzida por replay (undo), então a textura **precisa ser
 * determinística**: a mesma cor e espessura têm de gerar o mesmo padrão. Por
 * isso o ladrilho é gerado com PRNG semeado por cor + espessura, e não com
 * `Math.random()`.
 */

const tiles = new Map<string, HTMLCanvasElement>();

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTile(color: string, size: number): HTMLCanvasElement {
  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  const ctx = tile.getContext('2d');
  if (!ctx) return tile;

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);

  const rnd = mulberry32(hash(color) ^ Math.imul(size, 2654435761));

  // grão: muitos furos pequenos e fracos. Poucos furos grandes viravam
  // confete; cera é cobertura densa com falhas finas e de baixo contraste.
  ctx.globalCompositeOperation = 'destination-out';
  const blobs = Math.round(size * 4.5);
  for (let i = 0; i < blobs; i++) {
    ctx.globalAlpha = 0.08 + rnd() * 0.24;
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, 0.3 + rnd() * size * 0.018, 0, Math.PI * 2);
    ctx.fill();
  }

  // riscos da cera: poucos, finos, quase invisíveis
  const scratches = Math.round(size * 0.14);
  ctx.lineCap = 'round';
  for (let i = 0; i < scratches; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = size * (0.08 + rnd() * 0.2);
    const angle = (rnd() - 0.5) * 1.2;
    ctx.globalAlpha = 0.08 + rnd() * 0.18;
    ctx.lineWidth = 0.5 + rnd() * size * 0.008;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  // falhas pontuais: onde o papel aparece de verdade (poucas e pequenas)
  const specks = Math.round(size * 0.34);
  for (let i = 0; i < specks; i++) {
    ctx.globalAlpha = 0.55 + rnd() * 0.35;
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, 0.35 + rnd() * size * 0.019, 0, Math.PI * 2);
    ctx.fill();
  }

  return tile;
}

export function grainPattern(
  ctx: CanvasRenderingContext2D,
  color: string,
  width: number,
): CanvasPattern | null {
  const size = Math.max(28, Math.round(width * 1.3));
  const key = `${color}|${size}`;
  let tile = tiles.get(key);
  if (!tile) {
    tile = buildTile(color, size);
    tiles.set(key, tile);
  }
  return ctx.createPattern(tile, 'repeat');
}
