#!/usr/bin/env node
/**
 * Separa a folha colorida dos jamo coreanos (assets-src/coreano/sheet.png) em
 * um PNG por letra, todos no mesmo canvas.
 *
 * A folha é uma arte única: 40 personagens em 6 linhas, sobre fundo branco e
 * sem grades. Cada personagem é um componente conexo separado, mas quase todos
 * têm adereços soltos (chapéu, texto "WAND", seta, câmera, linhas de fedor…)
 * que NÃO podem ser cortados pela metade no recorte.
 *
 * Por isso o recorte não usa células geométricas. Usa posse de componente:
 *
 *   1. todo componente conexo da folha pertence a uma letra;
 *   2. componente contido na caixa do corpo de uma letra -> é dela (olhos,
 *      boca, contorno interno…);
 *   3. os demais (adereços) são agrupados por vizinhança e o grupo inteiro vai
 *      para a letra cuja caixa, dilatada em NEAR px, cobre mais área do grupo
 *      — adereço flutua acima/ao lado do dono e a dilatação pesa os dois eixos
 *      ao mesmo tempo (distância pura jogava o "W" de WAND no ㅇ vizinho,
 *      sobreposição só em x jogava adereço na linha de baixo);
 *   4. o recorte é a união dos componentes da letra, centrada num canvas
 *      uniforme — o mesmo de todas as letras, então o tamanho relativo entre
 *      elas se mantém.
 *
 * Uso: node scripts/crop-coreano.mjs
 * Saída: assets-src/coreano/<nome>.png e _qa/coreano/conferencia.png
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROWS } from './coreano-jamo.mjs';

const SRC = 'assets-src/coreano/sheet.png';
const OUT = 'assets-src/coreano';
const QA = '_qa/coreano';
const PAD = 6;          // folga em volta da união, em px da folha
const MIN_AREA = 8;     // abaixo disso é ruído de antialiasing
const CLUSTER_GAP = 10; // adereços a até 10 px um do outro formam um grupo
const ASPECT = 251 / 329; // proporção do canvas das letras latinas (2048x1562)


fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(QA, { recursive: true });

const { data, info } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const CH = info.channels;

/** Branco => fundo; qualquer canal abaixo de 245 => sprite. */
const ink = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const o = i * CH;
  ink[i] = data[o] < 245 || data[o + 1] < 245 || data[o + 2] < 245 ? 1 : 0;
}

/* ---------- 1. componentes conexos (8-conexo) ---------- */

const labels = new Int32Array(W * H).fill(-1);
const comps = [];
const stack = new Int32Array(W * H);
for (let start = 0; start < W * H; start++) {
  if (!ink[start] || labels[start] !== -1) continue;
  const id = comps.length;
  let sp = 0;
  stack[sp++] = start;
  labels[start] = id;
  let area = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % W, y = (i / W) | 0;
    area++;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        const j = ny * W + nx;
        if (ink[j] && labels[j] === -1) {
          labels[j] = id;
          stack[sp++] = j;
        }
      }
    }
  }
  comps.push({ id, area, x0, y0, x1, y1 });
}

const boxOf = ([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 });
const letters = ROWS.flatMap((r) =>
  r.items.map(([name, glyph, body]) => ({ name, glyph, box: boxOf(body) })),
);
const kept = comps.filter((c) => c.area >= MIN_AREA);

/* ---------- 2. posse: corpo -> contenção, adereço -> grupo ---------- */

const inside = (c, b) => c.x0 >= b.x0 && c.x1 <= b.x1 && c.y0 >= b.y0 && c.y1 <= b.y1;
const gap = (a, b) => Math.hypot(
  Math.max(b.x0 - a.x1, 0, a.x0 - b.x1),
  Math.max(b.y0 - a.y1, 0, a.y0 - b.y1),
);

/** Área de interseção do adereço com a caixa do corpo dilatada em NEAR px. */
const NEAR = 24;
const hugScore = (c, b) => {
  const ix = Math.max(0, Math.min(c.x1, b.x1 + NEAR) - Math.max(c.x0, b.x0 - NEAR));
  const iy = Math.max(0, Math.min(c.y1, b.y1 + NEAR) - Math.max(c.y0, b.y0 - NEAR));
  return ix * iy;
};

const owner = new Map(letters.map((l) => [l.name, []]));
const orphans = [];
for (const c of kept) {
  const hosts = letters.filter((l) => inside(c, l.box));
  if (hosts.length === 1) {
    owner.get(hosts[0].name).push(c);
    continue;
  }
  // dentro de mais de um corpo (caixas encostadas): fica com a menor caixa
  if (hosts.length > 1) {
    hosts.sort((p, q) => (p.box.x1 - p.box.x0) * (p.box.y1 - p.box.y0)
      - (q.box.x1 - q.box.x0) * (q.box.y1 - q.box.y0));
    owner.get(hosts[0].name).push(c);
    continue;
  }
  orphans.push(c);
}

/* agrupa adereços vizinhos (texto + seta + varinha formam um grupo só) */
const clusters = [];
for (const c of orphans) {
  const hit = clusters.filter((g) => g.some((m) => gap(c, m) <= CLUSTER_GAP));
  if (hit.length === 0) {
    clusters.push([c]);
  } else {
    // une todos os grupos que ele conecta
    const merged = [c, ...hit.flat()];
    for (const g of hit) clusters.splice(clusters.indexOf(g), 1);
    clusters.push(merged);
  }
}

const bounds = (list) => ({
  x0: Math.min(...list.map((c) => c.x0)),
  y0: Math.min(...list.map((c) => c.y0)),
  x1: Math.max(...list.map((c) => c.x1)),
  y1: Math.max(...list.map((c) => c.y1)),
});

const propsLog = [];
for (const g of clusters) {
  const box = bounds(g);
  const ranked = letters
    .map((l) => ({ l, hug: hugScore(box, l.box), d: gap(box, l.box) }))
    .sort((p, q) => q.hug - p.hug || p.d - q.d);
  const best = ranked[0];
  const runnerUp = ranked[1];
  owner.get(best.l.name).push(...g);
  propsLog.push({
    letter: best.l.name,
    glyph: best.l.glyph,
    area: g.reduce((s, c) => s + c.area, 0),
    pieces: g.length,
    box,
    runnerUp: runnerUp.l.name,
    hug: best.hug,
    runnerUpHug: runnerUp.hug,
  });
}

/* ---------- 3. canvas uniforme ---------- */

const crops = letters.map((l) => {
  const cs = owner.get(l.name);
  if (cs.length === 0) throw new Error(`letra sem componentes: ${l.name}`);
  const box = bounds(cs);
  let count = 0;
  for (const c of cs) count += c.area;
  return {
    ...l,
    ids: cs.map((c) => c.id),
    box,
    w: box.x1 - box.x0 + 1,
    h: box.y1 - box.y0 + 1,
    area: count,
  };
});

const CW = Math.max(...crops.map((c) => c.w)) + PAD * 2;
const CHh = Math.max(Math.round(CW * ASPECT), Math.max(...crops.map((c) => c.h)) + PAD * 2);
console.log(`canvas uniforme: ${CW}x${CHh} (${(CW / CHh).toFixed(3)}:1, latinas 1.311:1)`);

const raw = Buffer.alloc(CW * CHh * 3);
for (const c of crops) {
  raw.fill(255);
  const ox = Math.round((CW - c.w) / 2);
  const oy = Math.round((CHh - c.h) / 2);
  const { x0: bx0, y0: by0 } = c.box;

  for (let y = by0; y <= c.box.y1; y++) {
    for (let x = bx0; x <= c.box.x1; x++) {
      const p = y * W + x;
      if (labels[p] < 0 || !c.ids.includes(labels[p])) continue;
      const src = p * CH;
      const dst = ((y - by0 + oy) * CW + (x - bx0 + ox)) * 3;
      raw[dst] = data[src];
      raw[dst + 1] = data[src + 1];
      raw[dst + 2] = data[src + 2];
    }
  }

  await sharp(raw, { raw: { width: CW, height: CHh, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, `${c.name}.png`));
}

fs.writeFileSync(
  path.join(QA, 'recortes.json'),
  JSON.stringify(
    {
      canvas: [CW, CHh],
      folha: [W, H],
      letras: crops.map((c) => ({ name: c.name, glyph: c.glyph, box: [c.box.x0, c.box.y0, c.box.x1, c.box.y1], comps: c.ids })),
    },
    null,
    2,
  ),
);

console.log(`${crops.length} letras salvas em ${OUT}`);
for (const c of crops) {
  console.log(`  ${c.name.padEnd(13)} ${String(c.w).padStart(3)}x${String(c.h).padStart(3)}  comps=${c.ids.length}  ${c.ids.join(',')}`);
}

/* ---------- 4. relatório dos adereços ---------- */

fs.writeFileSync(path.join(QA, 'aderecos.json'), JSON.stringify(propsLog, null, 2));
console.log(`\n${propsLog.length} adereços agrupados:`);
for (const p of propsLog) {
  console.log(
    `  ${p.glyph} ${p.letter.padEnd(13)} ${String(p.pieces).padStart(2)} peça(s) ${String(p.area).padStart(5)}px ` +
    `em (${p.box.x0},${p.box.y0})-(${p.box.x1},${p.box.y1})  abraço=${p.hug}px²` +
    (p.runnerUpHug >= p.hug ? `  EMPATE com ${p.runnerUp}` : `  (2º: ${p.runnerUp} ${p.runnerUpHug}px²)`),
  );
}
const ambiguous = propsLog.filter((p) => p.runnerUpHug >= p.hug);
if (ambiguous.length) console.log(`ATENÇÃO: ${ambiguous.length} adereço(s) sem vencedor claro`);

/* ---------- 5. prancha de conferência ---------- */

const cols = 8;
const tileW = 300;
const tileH = 250;
const rowsN = Math.ceil(crops.length / cols);
const sheetW = cols * tileW;
const sheetH = rowsN * tileH;
const scale = Math.min((tileW - 16) / CW, (tileH - 40) / CHh);

const tiles = await Promise.all(
  crops.map(async (c, i) => {
    const buf = await sharp(path.join(OUT, `${c.name}.png`))
      .resize({ width: Math.round(CW * scale), kernel: 'lanczos3' })
      .png()
      .toBuffer();
    return {
      input: buf,
      left: (i % cols) * tileW + Math.round((tileW - CW * scale) / 2),
      top: Math.floor(i / cols) * tileH + 30 + Math.round((tileH - 30 - CHh * scale) / 2),
    };
  }),
);

const labels2 = crops
  .map((c, i) => {
    const x = (i % cols) * tileW + 10;
    const y = Math.floor(i / cols) * tileH + 20;
    return `<text x="${x}" y="${y}" font-family="Helvetica" font-size="16" fill="#555">${i + 1}. ${c.name} ${c.glyph}</text>`;
  })
  .join('');

const guide = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}">
  <rect width="${sheetW}" height="${sheetH}" fill="#fff"/>${labels2}
  ${crops.map((_, i) => `<rect x="${(i % cols) * tileW + 0.5}" y="${Math.floor(i / cols) * tileH + 0.5}" width="${tileW - 1}" height="${tileH - 1}" fill="none" stroke="#e6e6e6"/>`).join('')}
</svg>`;
await sharp(Buffer.from(guide)).composite(tiles).png().toFile(path.join(QA, 'conferencia.png'));
console.log(`\nprancha: ${path.join(QA, 'conferencia.png')}`);
