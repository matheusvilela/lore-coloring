#!/usr/bin/env node
/**
 * Traça a prancha colorida em um SVG preto e branco por personagem.
 *
 * Entrada : assets-src/sheet/source.png
 * Saída   : assets-src/sheet/svg/NN.svg
 *           assets-src/sheet/manifest.json
 *           _qa/sheet-prancha.png
 *
 * Uso: node scripts/trace-sheet.mjs
 * Requer: potrace e sharp. Não roda no CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const SRC = 'assets-src/sheet/source.png';
const SVG_DIR = 'assets-src/sheet/svg';
const MANIFEST = 'assets-src/sheet/manifest.json';
const QA = '_qa/sheet-prancha.png';
const TMP = '.tmp-assets/sheet';

const PAPER = 242;          // os três canais acima disto = fundo
const INK_MAX = 45;         // traço desenhado (preto), não o preenchimento colorido
const INK_CHROMA = 36;
const HOLLOW_AT = 10;       // espessura (distância à borda) a partir da qual o miolo é preenchimento
const RIM = 3;              // espessura do contorno que substitui um preenchimento escuro
const MAX_GAP = 24;         // junta asa, lata, lâmpada, vapor ao corpo mais próximo
const LARGE_AREA = 2200;
const PAD = 8;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const log = (...a) => console.log(...a);

function isPaper(r, g, b) {
  return r > PAPER && g > PAPER && b > PAPER;
}

function isInk(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx <= INK_MAX && mx - mn <= INK_CHROMA;
}

function labelMask(mask, w, h) {
  const n = w * h;
  const labels = new Int32Array(n).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i] || labels[i] !== -1) continue;
    const id = comps.length;
    let area = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    stack.push(i);
    labels[i] = id;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p / w) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && labels[q] === -1) {
          labels[q] = id;
          stack.push(q);
        }
      }
    }
    comps.push({ id, area, minX, minY, maxX, maxY, bw: maxX - minX + 1, bh: maxY - minY + 1 });
  }
  return { labels, comps };
}

/** Distância 8-conexa até o pixel fora da máscara. Fora da máscara fica 0. */
function distanceToEdge(mask, w, h) {
  const n = w * h;
  const dist = new Uint16Array(n);
  const q = new Int32Array(n);
  let qs = 0, qe = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = (i / w) | 0;
    let edge = false;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) {
        edge = true;
        break;
      }
    }
    if (edge) {
      dist[i] = 1;
      q[qe++] = i;
    }
  }
  while (qs < qe) {
    const p = q[qs++];
    const x = p % w, y = (p / w) | 0;
    const nd = dist[p] + 1;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const qq = ny * w + nx;
      if (mask[qq] && dist[qq] === 0) {
        dist[qq] = nd;
        q[qe++] = qq;
      }
    }
  }
  return dist;
}

function bboxGap(a, b) {
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX) - 1);
  const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY) - 1);
  return Math.hypot(dx, dy);
}

function toPBM(bits, w, h) {
  const rowBytes = Math.ceil(w / 8);
  const buf = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bits[y * w + x]) buf[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([Buffer.from(`P4\n${w} ${h}\n`), buf]);
}

function patchSvg(raw, w, h) {
  const body = raw
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')
    .trim();
  const root = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">`;
  return `${body.replace(/<svg[^>]*>/, root)}\n`;
}

function trace(bits, w, h) {
  const pbmPath = path.join(TMP, 'crop.pbm');
  const svgPath = path.join(TMP, 'crop.svg');
  fs.writeFileSync(pbmPath, toPBM(bits, w, h));
  execFileSync('potrace', [
    '-s', '-o', svgPath,
    '--turdsize', '2',
    '--alphamax', '1',
    '--opttolerance', '0.2',
    pbmPath,
  ], { stdio: 'pipe' });
  return patchSvg(fs.readFileSync(svgPath, 'utf8'), w, h);
}

function isLarge(c) {
  return c.area >= LARGE_AREA || (c.bw >= 64 && c.bh >= 52 && c.area >= 1500);
}

function isLetterLike(c) {
  if (c.bh < 8 || c.bh > 26 || c.bw < 4 || c.bw > 32) return false;
  if (c.area < 15 || c.area > c.bw * c.bh * 0.85) return false;
  return true;
}

/**
 * O rótulo "WAND" e a seta debaixo dele. Letras miúdas alinhadas,
 * fora da caixa de um corpo grande.
 */
function dropLabel(comps, large) {
  const drop = new Set();
  const letters = comps.filter((c) => {
    if (isLarge(c) || !isLetterLike(c)) return false;
    const cx = (c.minX + c.maxX) / 2;
    const cy = (c.minY + c.maxY) / 2;
    return !large.some((b) => cx >= b.minX && cx <= b.maxX && cy >= b.minY && cy <= b.maxY);
  });
  const parent = letters.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const unite = (i, j) => { parent[find(i)] = find(j); };
  for (let i = 0; i < letters.length; i++) {
    for (let j = i + 1; j < letters.length; j++) {
      const a = letters[i], b = letters[j];
      const cyA = (a.minY + a.maxY) / 2, cyB = (b.minY + b.maxY) / 2;
      if (Math.abs(cyA - cyB) > 8) continue;
      if (bboxGap(a, b) > 16) continue;
      unite(i, j);
    }
  }
  const groups = new Map();
  letters.forEach((c, i) => {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  });
  for (const group of groups.values()) {
    if (group.length < 3) continue;
    const box = {
      minX: Math.min(...group.map((c) => c.minX)),
      minY: Math.min(...group.map((c) => c.minY)),
      maxX: Math.max(...group.map((c) => c.maxX)),
      maxY: Math.max(...group.map((c) => c.maxY)),
    };
    for (const c of group) drop.add(c.id);
    for (const c of comps) {
      if (drop.has(c.id) || isLarge(c)) continue;
      const overlapsX = c.maxX >= box.minX - 4 && c.minX <= box.maxX + 4;
      const justBelow = c.minY >= box.maxY - 2 && c.minY <= box.maxY + 22;
      if (overlapsX && justBelow && c.bw <= 36 && c.bh <= 36 && c.area < 500) drop.add(c.id);
    }
  }
  return drop;
}

function assignCharacters(comps, labels, w, h) {
  const n = w * h;
  const large = comps.filter(isLarge);
  const dropped = dropLabel(comps, large);
  const largeId = new Set(large.map((c) => c.id));

  const nearest = new Int32Array(n).fill(-1);
  const ndist = new Uint8Array(n).fill(255);
  const q = new Int32Array(n);
  let qs = 0, qe = 0;
  for (let i = 0; i < n; i++) {
    const id = labels[i];
    if (id < 0 || !largeId.has(id)) continue;
    nearest[i] = id;
    ndist[i] = 0;
    q[qe++] = i;
  }
  while (qs < qe) {
    const p = q[qs++];
    if (ndist[p] >= MAX_GAP) continue;
    const x = p % w, y = (p / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const qq = ny * w + nx;
      if (ndist[qq] <= ndist[p] + 1) continue;
      ndist[qq] = ndist[p] + 1;
      nearest[qq] = nearest[p];
      q[qe++] = qq;
    }
  }

  const parent = new Int32Array(comps.length).fill(-1);
  for (const c of large) parent[c.id] = c.id;

  for (const c of comps) {
    if (parent[c.id] !== -1 || dropped.has(c.id) || c.area < 12) continue;
    let best = -1, bestD = 999;
    // amostra a caixa: o pixel mais perto de um corpo grande
    const step = c.area > 4000 ? 2 : 1;
    for (let y = c.minY; y <= c.maxY; y += step) {
      for (let x = c.minX; x <= c.maxX; x += step) {
        const i = y * w + x;
        if (labels[i] !== c.id) continue;
        if (nearest[i] !== -1 && ndist[i] > 0 && ndist[i] < bestD) {
          bestD = ndist[i];
          best = nearest[i];
        }
      }
    }
    if (best !== -1 && bestD <= MAX_GAP) parent[c.id] = best;
  }

  // pupila no branco do olho: longe do traço, mas dentro da caixa do corpo
  for (const c of comps) {
    if (parent[c.id] !== -1 || dropped.has(c.id) || c.area < 12) continue;
    const cx = (c.minX + c.maxX) / 2;
    const cy = (c.minY + c.maxY) / 2;
    let host = null;
    for (const b of large) {
      if (cx < b.minX || cx > b.maxX || cy < b.minY || cy > b.maxY) continue;
      if (!host || b.area < host.area) host = b;
    }
    if (host) parent[c.id] = host.id;
  }

  // sobras soltas (não são rótulo): agrupam entre si se estiverem perto
  const loose = comps.filter((c) => parent[c.id] === -1 && !dropped.has(c.id) && c.area >= 12);
  const uf = new Map(loose.map((c) => [c.id, c.id]));
  const find = (id) => (uf.get(id) === id ? id : uf.set(id, find(uf.get(id))).get(id));
  for (let i = 0; i < loose.length; i++) {
    for (let j = i + 1; j < loose.length; j++) {
      if (bboxGap(loose[i], loose[j]) <= MAX_GAP) uf.set(find(loose[i].id), find(loose[j].id));
    }
  }
  const clusters = new Map();
  for (const c of loose) {
    const g = find(c.id);
    if (!clusters.has(g)) clusters.set(g, []);
    clusters.get(g).push(c);
  }
  for (const group of clusters.values()) {
    const area = group.reduce((s, c) => s + c.area, 0);
    const bw = Math.max(...group.map((c) => c.maxX)) - Math.min(...group.map((c) => c.minX));
    const bh = Math.max(...group.map((c) => c.maxY)) - Math.min(...group.map((c) => c.minY));
    if (area < 200 || (bw < 18 && bh < 18)) continue;
    const root = group[0].id;
    for (const c of group) parent[c.id] = root;
  }

  // um chapéu largo em cima da cabeça é parte do mesmo personagem,
  // mesmo quando os dois pedaços são grandes. Não junta vizinhos lado a lado
  // nem uma letra inteira da fileira de cima.
  let stacked = 0;
  for (let i = 0; i < large.length; i++) {
    for (let j = i + 1; j < large.length; j++) {
      const a = large[i], b = large[j];
      const upper = a.minY <= b.minY ? a : b;
      const lower = upper === a ? b : a;
      if (upper.bh > 80 || lower.bh <= upper.bh) continue;
      const vGap = lower.minY - upper.maxY - 1;
      if (vGap < -4 || vGap > 12) continue;
      const overlapX = Math.min(upper.maxX, lower.maxX) - Math.max(upper.minX, lower.minX) + 1;
      if (overlapX < upper.bw * 0.85) continue;
      parent[upper.id] = lower.id;
      stacked++;
    }
  }
  if (stacked) log(`chapéus grudados no corpo: ${stacked}`);

  // id de personagem estável, na ordem do componente-raiz
  const roots = [];
  const charOfComp = new Int32Array(comps.length).fill(-1);
  for (const c of comps) {
    if (parent[c.id] === -1) continue;
    let root = parent[c.id];
    // um chapéu aponta para o corpo; o corpo aponta para si
    const seen = new Set();
    while (parent[root] !== -1 && parent[root] !== root && !seen.has(root)) {
      seen.add(root);
      root = parent[root];
    }
    parent[c.id] = root;
    if (!roots.includes(root)) roots.push(root);
    charOfComp[c.id] = roots.indexOf(root);
  }

  const pixelChar = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const id = labels[i];
    if (id >= 0) pixelChar[i] = charOfComp[id];
  }
  return { pixelChar, charCount: roots.length, dropped: dropped.size };
}

function readingOrder(chars) {
  const sorted = [...chars].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const rows = [];
  for (const c of sorted) {
    const row = rows[rows.length - 1];
    if (!row || c.cy - row.anchor > 110) rows.push({ anchor: c.cy, items: [c] });
    else row.items.push(c);
  }
  const ordered = [];
  rows.forEach((row, r) => {
    row.items.sort((a, b) => a.cx - b.cx);
    row.items.forEach((c, col) => ordered.push({ ...c, row: r, col }));
  });
  return ordered;
}

async function contactSheet(source, recon, cells) {
  const srcMeta = await sharp(source).metadata();
  const panelW = 900;
  const panelH = Math.round(panelW * srcMeta.height / srcMeta.width);
  const srcPanel = await sharp(source).resize(panelW, panelH).png().toBuffer();
  const reconPanel = await sharp(recon).resize(panelW, panelH).png().toBuffer();
  const caption = (text) => Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${panelW}" height="36">
      <rect width="100%" height="100%" fill="#fff"/>
      <text x="8" y="26" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#222">${text}</text>
    </svg>`,
  );
  const capSrc = await sharp(caption('source')).png().toBuffer();
  const capTraced = await sharp(caption('traced')).png().toBuffer();

  const cellW = 180, cellH = 200, labelH = 24;
  const cols = Math.max(...cells.map((c) => c.col)) + 1;
  const rowCount = Math.max(...cells.map((c) => c.row)) + 1;
  const gridW = cols * cellW;
  const gridH = rowCount * cellH;
  const grid = sharp({
    create: { width: gridW, height: gridH, channels: 3, background: '#f3f3f3' },
  });
  const overlays = [];
  for (const cell of cells) {
    const left = cell.col * cellW;
    const top = cell.row * cellH;
    const art = await sharp(Buffer.from(cell.svg))
      .resize(cellW - 16, cellH - labelH - 16, { fit: 'inside', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
    const meta = await sharp(art).metadata();
    const ax = left + Math.round((cellW - meta.width) / 2);
    const ay = top + labelH + Math.round((cellH - labelH - meta.height) / 2);
    overlays.push({ input: art, left: ax, top: ay });
    const label = await sharp(Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cellW - 4}" height="${labelH}">
        <rect width="100%" height="100%" fill="#f3f3f3"/>
        <text x="8" y="17" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#333">${cell.name}</text>
      </svg>`,
    )).png().toBuffer();
    overlays.push({ input: label, left: left + 2, top: top + 2 });
  }
  const gridPng = await grid.composite(overlays).png().toBuffer();

  const width = Math.max(panelW * 2 + 24, gridW);
  const height = 36 + panelH + 28 + gridH;
  const canvas = sharp({
    create: { width, height, channels: 3, background: '#ffffff' },
  });
  return canvas.composite([
    { input: capSrc, left: 0, top: 0 },
    { input: capTraced, left: panelW + 24, top: 0 },
    { input: srcPanel, left: 0, top: 36 },
    { input: reconPanel, left: panelW + 24, top: 36 },
    { input: gridPng, left: 0, top: 36 + panelH + 28 },
  ]).png().toBuffer();
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`faltou ${SRC}`);
  fs.mkdirSync(SVG_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(QA), { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, n = w * h;
  const fg = new Uint8Array(n);
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    if (isPaper(r, g, b)) continue;
    fg[i] = 1;
    if (isInk(r, g, b)) ink[i] = 1;
  }

  const inkParts = labelMask(ink, w, h);
  const inkDist = distanceToEdge(ink, w, h);
  const maxInk = new Uint16Array(inkParts.comps.length);
  for (let i = 0; i < n; i++) {
    if (!ink[i]) continue;
    const id = inkParts.labels[i];
    if (inkDist[i] > maxInk[id]) maxInk[id] = inkDist[i];
  }
  const stroke = new Uint8Array(n);
  let hollowed = 0;
  for (let i = 0; i < n; i++) {
    if (!ink[i]) continue;
    const id = inkParts.labels[i];
    if (maxInk[id] < HOLLOW_AT || inkDist[i] <= RIM) stroke[i] = 1;
    else hollowed++;
  }
  log(`tinta: ${inkParts.comps.length} componentes, ${hollowed} px de preenchimento esvaziado`);

  // cor alcançável pelo fundo (não está presa dentro de um contorno)
  const outside = new Uint8Array(n);
  const oq = new Int32Array(n);
  let oqs = 0, oqe = 0;
  const pushOutside = (i) => {
    if (outside[i] || ink[i]) return;
    outside[i] = 1;
    oq[oqe++] = i;
  };
  for (let x = 0; x < w; x++) { pushOutside(x); pushOutside((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { pushOutside(y * w); pushOutside(y * w + w - 1); }
  while (oqs < oqe) {
    const p = oq[oqs++];
    const x = p % w, y = (p / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      pushOutside(ny * w + nx);
    }
  }

  // Borda de cor que encosta no papel e não no traço preto: chifre, lata,
  // vapor, fumaça. O preenchimento que já tem contorno preto não entra.
  const edge = new Uint8Array(n);
  let edgeCount = 0;
  for (let i = 0; i < n; i++) {
    if (!fg[i] || ink[i] || !outside[i] || stroke[i]) continue;
    const x = i % w, y = (i / w) | 0;
    let paperN = false, inkN = false;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) { paperN = true; continue; }
      const q = ny * w + nx;
      if (ink[q]) inkN = true;
      else if (!fg[q]) paperN = true;
    }
    if (paperN && !inkN) { edge[i] = 1; edgeCount++; }
  }
  log(`borda de cor sem traço: ${edgeCount} px`);

  const fgParts = labelMask(fg, w, h);
  const { pixelChar, charCount, dropped } = assignCharacters(fgParts.comps, fgParts.labels, w, h);
  log(`personagens: ${charCount}, componentes de rótulo descartados: ${dropped}`);

  // engrossa a borda de cor e leva o id do personagem para o papel ao lado
  for (let pass = 0; pass < 2; pass++) {
    const grow = [];
    for (let i = 0; i < n; i++) {
      if (!edge[i] || pixelChar[i] < 0) continue;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (edge[q] || ink[q]) continue;
        grow.push(q, pixelChar[i]);
      }
    }
    for (let k = 0; k < grow.length; k += 2) {
      const q = grow[k];
      if (edge[q]) continue;
      edge[q] = 1;
      if (pixelChar[q] < 0) pixelChar[q] = grow[k + 1];
    }
  }
  for (let i = 0; i < n; i++) if (edge[i]) stroke[i] = 1;

  // o rótulo WAND e a seta; a borda da bruxa começa mais à direita
  let wandLeft = 0;
  for (let y = 193; y <= 233; y++) {
    for (let x = 168; x <= 216; x++) {
      if (stroke[y * w + x] && pixelChar[y * w + x] >= 0) wandLeft++;
    }
  }
  if (wandLeft > 0) throw new Error(`rótulo WAND não foi descartado (${wandLeft} px)`);

  const drafts = [];
  for (let id = 0; id < charCount; id++) {
    let minX = w, minY = h, maxX = -1, maxY = -1, count = 0, sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      if (!stroke[i] || pixelChar[i] !== id) continue;
      const x = i % w, y = (i / w) | 0;
      count++;
      sx += x; sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (count < 30) continue;
    drafts.push({ id, minX, minY, maxX, maxY, count, cx: sx / count, cy: sy / count });
  }
  const ordered = readingOrder(drafts);
  log(`svgs: ${ordered.length} em ${Math.max(...ordered.map((c) => c.row)) + 1} linhas`);

  for (const old of fs.readdirSync(SVG_DIR)) {
    if (old.endsWith('.svg')) fs.unlinkSync(path.join(SVG_DIR, old));
  }

  const recon = Buffer.alloc(n * 3, 255);
  const cells = [];
  const manifestChars = [];
  for (let index = 0; index < ordered.length; index++) {
    const c = ordered[index];
    const x0 = Math.max(0, c.minX - PAD);
    const y0 = Math.max(0, c.minY - PAD);
    const x1 = Math.min(w - 1, c.maxX + PAD);
    const y1 = Math.min(h - 1, c.maxY + PAD);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const bits = new Uint8Array(cw * ch);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (stroke[i] && pixelChar[i] === c.id) bits[(y - y0) * cw + (x - x0)] = 1;
      }
    }
    const svg = trace(bits, cw, ch);
    if (!svg.includes('<path')) throw new Error(`potrace não gerou traço para ${index}`);
    const name = String(index + 1).padStart(2, '0');
    const file = `${name}.svg`;
    fs.writeFileSync(path.join(SVG_DIR, file), svg);
    const rendered = await sharp(Buffer.from(svg))
      .resize(cw, ch, { fit: 'fill', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .raw()
      .toBuffer();
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (rendered[(y * cw + x) * 3] < 128) {
          const o = ((y0 + y) * w + (x0 + x)) * 3;
          recon[o] = recon[o + 1] = recon[o + 2] = 0;
        }
      }
    }
    cells.push({ name, file, row: c.row, col: c.col, svg });
    manifestChars.push({ file, row: c.row, col: c.col, x: x0, y: y0, w: cw, h: ch });
    log(`  ${file}  linha ${c.row} col ${c.col}  ${cw}x${ch}`);
  }

  const manifest = {
    source: SRC,
    width: w,
    height: h,
    characters: manifestChars,
  };
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  const reconPng = await sharp(recon, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  const sheet = await contactSheet(SRC, reconPng, cells);
  await sharp(sheet).png().toFile(QA);
  log(`manifesto: ${MANIFEST}`);
  log(`prancha: ${QA}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
