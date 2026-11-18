#!/usr/bin/env node
/**
 * Pipeline de assets do lore-coloring.
 *
 * Entrada : assets-src/<idioma>/{<letra>.png}  (uma imagem por letra, mesmo
 *           canvas para todas, fundo branco)
 * Saída   : public/<idioma>/<letra>/
 *             ink.svg     fonte vetorial (viewBox = bbox compartilhado)
 *             ink.png     preto + alpha, 2048x1562 (metade do canvas de pintura)
 *             region.png  mapa de regiões do balde, 1024x781 (R+G = id)
 *             thumb.webp  miniatura para a grade
 *           _qa/.../prancha.png  prancha de contato para aprovação visual
 *
 * Idiomas:
 *   latin   A–Z, arte já em traço preto (lê direto a luminância)
 *   coreano 40 jamo, arte colorida (extrai só o traço preto antes de vetorizar)
 *
 * Uso: node scripts/build-assets.mjs [latin|coreano|all]
 * Requer: potrace (Homebrew) e sharp (devDependency).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { JAMO } from './coreano-jamo.mjs';

const LANGS = {
  latin: {
    src: 'assets-src/letras',
    out: 'public/letras',
    qa: '_qa',
    letters: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((id) => ({ id, label: id })),
    ink: 'dark',
  },
  coreano: {
    src: 'assets-src/coreano',
    out: 'public/coreano',
    qa: '_qa/coreano',
    letters: JAMO.map((j, i) => ({ id: j.name, label: `${i + 1}. ${j.name} ${j.glyph}` })),
    ink: 'stroke',
  },
};

const TMP = '.tmp-assets';

const CANVAS = { w: 2048, h: 1562 };          // resolução da camada de pintura
const REGION = { w: 1024, h: 781 };           // metade exata de CANVAS
const THRESHOLD = 128;                        // < 128 = tinta
const PAD = 6;                                // folga no bbox compartilhado (px na fonte)

/**
 * Traço da arte colorida: o contorno é preto puro (#000000/#010101) e os
 * preenchimentos mais escuros começam em #1a1621 — então canal máximo ≤ 24
 * separa contorno de preenchimento com folga de 9 níveis. Os poucos pixels
 * tingidos que passam são a franja de antialiasing do próprio contorno.
 */
const STROKE_MAX = 24;

const log = (...a) => console.log(...a);

/* ---------- 0. preparo da tinta ---------- */

/**
 * Objeto desenhado só em valor: cinza neutro (sem matiz), fora de qualquer
 * área fechada por preto e com área relevante. As latas do `ㅛ` são o caso
 * real — sem contorno preto, encostadas nas hastes da letra. Sombras internas
 * (olho do `ㅗ`, lente do `ㅟ`) são cinza **cercado** por preto e ficam de fora,
 * assim como a franja de antialiasing (cinza colado no preto).
 */
const GREY_MAX = 253;      // branco da folha é 255; 246–253 ainda é corpo da lata
const GREY_NEUTRAL = 8;    // matiz: cinza é max−min ≤ 8
const GREY_MIN_AREA = 200; // abaixo disso é ruído/sobra, não objeto
const GREY_CLOSE = 2;      // fecha ranhuras e brilhos da lata antes do anel
const GREY_RING = 1;       // espessura do contorno gerado (× 2 = 2 px)

const dilate = (src, w, h, r) => {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w) out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
};

const erode = (src, w, h, r) => {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      let all = true;
      for (let dy = -r; dy <= r && all; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) { all = false; break; }
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || !src[ny * w + nx]) { all = false; break; }
        }
      }
      if (all) out[y * w + x] = 1;
    }
  }
  return out;
};

/** Pixels alcançáveis da borda sem atravessar preto (o "lado de fora" da arte). */
function outsideOf(black, w, h) {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const seed = (i) => {
    if (!black[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i; }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  return outside;
}

/** Contorno (anel de GREY_RING px) dos objetos cinza soltos. */
function greyObjectRing(data, w, h, CH) {
  const black = new Uint8Array(w * h);
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * CH;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const mx = Math.max(r, g, b);
    black[i] = mx <= STROKE_MAX ? 1 : 0;
    grey[i] = !black[i] && mx <= GREY_MAX && mx - Math.min(r, g, b) <= GREY_NEUTRAL ? 1 : 0;
  }
  // franja de antialiasing: cinza a até 2 px do preto não é objeto
  const nearBlack = dilate(black, w, h, 2);
  for (let i = 0; i < w * h; i++) if (nearBlack[i]) grey[i] = 0;

  const outside = outsideOf(black, w, h);

  // componentes: fica só o que é exposto (não cercado por preto) e grande
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const keep = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!grey[start] || label[start] !== -1) continue;
    const id = start; // marcador local, não precisa ser sequencial
    let sp = 0;
    stack[sp++] = start;
    label[start] = id;
    const members = [];
    let exposed = 0;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i / w) | 0;
      members.push(i);
      if (outside[i]) exposed++;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (grey[j] && label[j] === -1) { label[j] = id; stack[sp++] = j; }
        }
      }
    }
    if (members.length >= GREY_MIN_AREA && exposed * 2 >= members.length) {
      for (const i of members) keep[i] = 1;
    }
  }

  // closing: a lata tem ranhuras e brilho; sem fechar, o anel vira pente
  const silh = erode(dilate(keep, w, h, GREY_CLOSE), w, h, GREY_CLOSE);
  const inner = erode(silh, w, h, GREY_RING);
  const ring = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ring[i] = silh[i] && !inner[i] ? 1 : 0;
  return ring;
}

/** Arte colorida -> máscara preto/branco (traço), escrita em TMP. */
async function strokeMask(file, outFile) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: CH } = info;
  const ring = greyObjectRing(data, w, h, CH);
  const buf = Buffer.alloc(w * h);
  let outlined = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * CH;
    const mx = Math.max(data[o], data[o + 1], data[o + 2]);
    const ink = mx <= STROKE_MAX || ring[i];
    if (ring[i]) outlined++;
    buf[i] = ink ? 0 : 255;
  }
  if (outlined) log(`    ${path.basename(file)}: ${outlined} px de contorno de objeto`);
  await sharp(buf, { raw: { width: w, height: h, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(outFile);
  return { w, h };
}

/* ---------- 1. leitura e bbox compartilhado ---------- */

async function readGray(file) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function inkBBox({ data, w, h }) {
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] < THRESHOLD) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, count, w, h };
}

function toPBM({ data, w, h }) {
  const rowBytes = Math.ceil(w / 8);
  const buf = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] < THRESHOLD) buf[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([Buffer.from(`P4\n${w} ${h}\n`), buf]);
}

/* ---------- 2. vetorização ---------- */

function trace(pbmPath, svgPath) {
  execFileSync('potrace', [
    '-s', '-o', svgPath,
    '--turdsize', '2',        // remove manchas de até 2 px
    '--alphamax', '1',        // suaviza curvas sem perder cantos
    '--opttolerance', '0.2',
    pbmPath,
  ], { stdio: 'pipe' });
}

/** Reescreve o <svg> do potrace com viewBox no bbox compartilhado. */
function patchSvg(raw, box, px) {
  const body = raw
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')
    .trim();
  const root = `<svg xmlns="http://www.w3.org/2000/svg" width="${px.w}" height="${px.h}" viewBox="${box.minX} ${box.minY} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet">`;
  return body.replace(/<svg[^>]*>/, root);
}

/* ---------- 3. mapa de regiões (balde) ---------- */

function regionMap(alpha, w, h) {
  const n = w * h;
  const labels = new Int32Array(n).fill(-1);
  const isBarrier = (i) => alpha[i] >= 128;
  const stack = new Int32Array(n);
  const regions = [];

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || isBarrier(start)) continue;
    const id = regions.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    let area = 0, touchesBorder = false;
    let minX = w, minY = h, maxX = -1, maxY = -1;

    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i / w) | 0;
      area++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      // 4-conexo: barreira diagonal não vaza
      if (x > 0 && !isBarrier(i - 1) && labels[i - 1] === -1) { labels[i - 1] = id; stack[sp++] = i - 1; }
      if (x < w - 1 && !isBarrier(i + 1) && labels[i + 1] === -1) { labels[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && !isBarrier(i - w) && labels[i - w] === -1) { labels[i - w] = id; stack[sp++] = i - w; }
      if (y < h - 1 && !isBarrier(i + w) && labels[i + w] === -1) { labels[i + w] = id; stack[sp++] = i + w; }
    }
    regions.push({ id, area, touchesBorder, minX, minY, maxX, maxY });
  }

  // R+G = id (little endian), alpha 255
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const id = labels[i] < 0 ? 0xffff : labels[i];
    const o = i * 4;
    rgba[o] = id & 0xff;
    rgba[o + 1] = (id >> 8) & 0xff;
    rgba[o + 2] = 0;
    rgba[o + 3] = labels[i] < 0 ? 0 : 255;
  }
  return { rgba, labels, regions, w, h };
}

/* ---------- 3b. diagnóstico do balde ---------- */

/** Imagem de diagnóstico: cada região com uma cor; a região externa fica cinza-clara. */
function regionPreview(labels, regions, w, h) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const id = labels[i];
    const o = i * 4;
    if (id < 0) { buf[o] = 20; buf[o + 1] = 20; buf[o + 2] = 20; buf[o + 3] = 255; continue; }
    const isOuter = regions[id].touchesBorder;
    if (isOuter) { buf[o] = buf[o + 1] = buf[o + 2] = 232; buf[o + 3] = 255; continue; }
    const hue = (id * 137.508) % 360;
    const [r, g, b] = hsl(hue, 0.62, 0.58);
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
  }
  return buf;
}

function hsl(hDeg, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hDeg / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hDeg < 60 ? [c, x, 0] : hDeg < 120 ? [x, c, 0] : hDeg < 180 ? [0, c, x]
    : hDeg < 240 ? [0, x, c] : hDeg < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

/* ---------- 4. prancha de contato ---------- */

function sheet(items, box, cols = 6) {
  const tileW = 320, tileH = 260, pad = 16;
  const rows = Math.ceil(items.length / cols);
  const W = cols * tileW, H = rows * tileH;
  const s = Math.min(tileW / box.w, tileH / box.h) * 0.86;
  const groups = items.map((it, i) => {
    const g = it.body.match(/<g[\s\S]*<\/g>/)?.[0] ?? '';
    const cx = (i % cols) * tileW + tileW / 2;
    const cy = Math.floor(i / cols) * tileH + tileH / 2 + 8;
    const tx = cx - (box.minX + box.w / 2) * s;
    const ty = cy - (box.minY + box.h / 2) * s;
    return `<g transform="translate(${tx} ${ty}) scale(${s})">${g}</g>
      <text x="${(i % cols) * tileW + 12}" y="${Math.floor(i / cols) * tileH + 26}" font-family="Helvetica" font-size="${it.label.length > 6 ? 18 : 22}" fill="#888">${it.label}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#fff"/>${groups}</svg>`;
}

/* ---------- main ---------- */

async function build(langId, cfg) {
  const { src: SRC, out: OUT, qa: QA } = cfg;
  log(`\n=== ${langId}: ${cfg.letters.length} letras de ${SRC} ===`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(QA, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  // 0. arte colorida -> máscara de traço
  const files = new Map();
  for (const { id } of cfg.letters) {
    const source = path.join(SRC, `${id}.png`);
    if (!fs.existsSync(source)) throw new Error(`faltando ${source}`);
    if (cfg.ink === 'stroke') {
      const mask = path.join(TMP, `${langId}-${id}.png`);
      await strokeMask(source, mask);
      files.set(id, mask);
    } else {
      files.set(id, source);
    }
  }

  // 1. bbox compartilhado + métricas de tinta
  const inputs = [];
  for (const { id, label } of cfg.letters) {
    const gray = await readGray(files.get(id));
    inputs.push({ id, label, gray, bbox: inkBBox(gray) });
  }
  const sw = inputs[0].gray.w;
  const sh = inputs[0].gray.h;
  for (const i of inputs) {
    if (i.gray.w !== sw || i.gray.h !== sh) {
      throw new Error(`canvas diferente em ${i.id}: ${i.gray.w}x${i.gray.h} (esperado ${sw}x${sh})`);
    }
  }
  const box = {
    minX: Math.max(0, Math.min(...inputs.map((i) => i.bbox.minX)) - PAD),
    minY: Math.max(0, Math.min(...inputs.map((i) => i.bbox.minY)) - PAD),
    maxX: Math.min(sw - 1, Math.max(...inputs.map((i) => i.bbox.maxX)) + PAD),
    maxY: Math.min(sh - 1, Math.max(...inputs.map((i) => i.bbox.maxY)) + PAD),
  };
  box.w = box.maxX - box.minX + 1;
  box.h = box.maxY - box.minY + 1;
  log(`canvas fonte: ${sw}x${sh} · bbox compartilhado: ${box.w}x${box.h} @ (${box.minX},${box.minY})`);

  const scale = Math.min(CANVAS.w / box.w, CANVAS.h / box.h);
  const px = { w: Math.round(box.w * scale), h: Math.round(box.h * scale) };
  log(`render da tinta: ${px.w}x${px.h} (fator ${scale.toFixed(2)}x) em ${CANVAS.w}x${CANVAS.h}`);

  // region.png é exatamente metade do canvas: derivado do MESMO raster, garante alinhamento
  const pxLeft = Math.round((CANVAS.w - px.w) / 2);
  const pxTop = Math.round((CANVAS.h - px.h) / 2);

  const metrics = [];
  const sheetItems = [];

  for (const { id, label, gray } of inputs) {
    const dir = path.join(OUT, id);
    fs.mkdirSync(dir, { recursive: true });

    // vetor
    const pbmPath = path.join(TMP, `${langId}-${id}.pbm`);
    const rawSvgPath = path.join(TMP, `${langId}-${id}.svg`);
    fs.writeFileSync(pbmPath, toPBM(gray));
    trace(pbmPath, rawSvgPath);
    const rawSvg = fs.readFileSync(rawSvgPath, 'utf8');
    const svg = patchSvg(rawSvg, box, px);
    fs.writeFileSync(path.join(dir, 'ink.svg'), svg);

    // ink.png (preto + alpha) no canvas de pintura
    const inkTile = await sharp(Buffer.from(svg)).resize(px.w, px.h).png().toBuffer();
    const inkCanvas = await sharp({
      create: { width: CANVAS.w, height: CANVAS.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: inkTile, left: pxLeft, top: pxTop }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(path.join(dir, 'ink.png'), inkCanvas);

    // region.png — derivado do ink.png (downsample exato 2x), não de um render próprio
    const rRaw = await sharp(inkCanvas)
      .ensureAlpha()
      .resize(REGION.w, REGION.h, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const alpha = new Uint8Array(REGION.w * REGION.h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rRaw.data[i * 4 + 3];
    const rm = regionMap(alpha, REGION.w, REGION.h);
    await sharp(rm.rgba, { raw: { width: REGION.w, height: REGION.h, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, 'region.png'));

    // thumb
    await sharp({ create: { width: 320, height: 244, channels: 4, background: '#fff' } })
      .composite([{ input: await sharp(Buffer.from(svg)).resize(280).png().toBuffer(), gravity: 'center' }])
      .flatten({ background: '#fff' })
      .webp({ quality: 86 })
      .toFile(path.join(dir, 'thumb.webp'));

    const paintable = rm.regions.filter((r) => !r.touchesBorder && r.area >= REGION.w * REGION.h * 0.002);
    const largest = paintable.reduce((m, r) => Math.max(m, r.area), 0) / (REGION.w * REGION.h) * 100;

    fs.mkdirSync(path.join(QA, 'regioes'), { recursive: true });
    await sharp(regionPreview(rm.labels, rm.regions, REGION.w, REGION.h), {
      raw: { width: REGION.w, height: REGION.h, channels: 4 },
    }).resize(560).png().toFile(path.join(QA, 'regioes', `${id}.png`));

    metrics.push({
      letter: id,
      paths: (rawSvg.match(/<path/g) || []).length,
      regions: rm.regions.length,
      paintable: paintable.length,
      largestPct: +largest.toFixed(1),
      bytes: ['ink.svg', 'ink.png', 'region.png', 'thumb.webp']
        .reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0),
    });
    sheetItems.push({ label, body: rawSvg });
    log(`  ${id} ok`);
  }

  // prancha
  await sharp(Buffer.from(sheet(sheetItems, box))).png().toFile(path.join(QA, 'prancha.png'));

  const total = metrics.reduce((s, m) => s + m.bytes, 0);
  fs.writeFileSync(
    path.join(QA, 'metrics.json'),
    JSON.stringify({ lang: langId, source: { w: sw, h: sh }, box, px, total, metrics }, null, 2),
  );

  log('\nletra  paths  regiões  pintáveis  maior%  peso');
  for (const m of metrics) {
    log(`${m.letter.padEnd(14)} ${String(m.paths).padStart(2)}      ${String(m.regions).padStart(2)}        ${String(m.paintable).padStart(2)}       ${String(m.largestPct).padStart(4)}   ${(m.bytes / 1024).toFixed(0)} KB`);
  }
  log(`\ntotal ${OUT}: ${(total / 1024 / 1024).toFixed(2)} MB`);
  if (cfg.ink === 'dark') {
    log(`letras com o corpo sem região própria (balde vazaria): ${metrics.filter((m) => m.largestPct < 8).map((m) => m.letter).join(' ') || 'nenhuma'}`);
  } else {
    const sorted = metrics.map((m) => m.largestPct).sort((a, b) => a - b);
    log(`maior região pintável: ${sorted[0]}% a ${sorted[sorted.length - 1]}% do canvas `
      + `(jamo de traço aberto não têm região interna — ver seção 8.4 do doc)`);
  }
  log(`prancha: ${path.join(QA, 'prancha.png')} · regiões: ${path.join(QA, 'regioes')}`);
}

const arg = process.argv[2] ?? 'all';
const targets = arg === 'all' ? Object.keys(LANGS) : [arg];
for (const t of targets) {
  if (!LANGS[t]) {
    console.error(`idioma desconhecido: ${t} (use ${Object.keys(LANGS).join(', ')} ou all)`);
    process.exit(1);
  }
}
for (const t of targets) {
  await build(t, LANGS[t]);
}
