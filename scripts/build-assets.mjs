#!/usr/bin/env node
/**
 * Pipeline de assets do lore-coloring.
 *
 * Entrada : assets-src/letras/{A..Z}.png  (329x251, fundo branco, traço preto)
 * Saída   : public/letras/{A..Z}/
 *             ink.svg     fonte vetorial (viewBox = bbox compartilhado)
 *             ink.png     preto + alpha, 2048x1562 (metade do canvas de pintura)
 *             region.png  mapa de regiões do balde, 1024x781 (R+G = id)
 *             thumb.webp  miniatura para a grade
 *           _qa/prancha.png  prancha de contato para aprovação visual
 *
 * Uso: node scripts/build-assets.mjs
 * Requer: potrace (Homebrew) e sharp (devDependency).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const SRC = 'assets-src/letras';
const OUT = 'public/letras';
const QA = '_qa';
const TMP = '.tmp-assets';

const CANVAS = { w: 2048, h: 1562 };          // resolução da camada de pintura
const REGION = { w: 1024, h: 781 };           // metade exata de CANVAS
const THRESHOLD = 128;                        // < 128 = tinta
const PAD = 6;                                // folga no bbox compartilhado (px na fonte)

const log = (...a) => console.log(...a);

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

function sheet(svgs, box, cols = 6) {
  const tileW = 320, tileH = 260, pad = 16;
  const rows = Math.ceil(svgs.length / cols);
  const W = cols * tileW, H = rows * tileH;
  const s = Math.min(tileW / box.w, tileH / box.h) * 0.86;
  const groups = svgs.map((sv, i) => {
    const g = sv.body.match(/<g[\s\S]*<\/g>/)?.[0] ?? '';
    const cx = (i % cols) * tileW + tileW / 2;
    const cy = Math.floor(i / cols) * tileH + tileH / 2 + 8;
    const tx = cx - (box.minX + box.w / 2) * s;
    const ty = cy - (box.minY + box.h / 2) * s;
    return `<g transform="translate(${tx} ${ty}) scale(${s})">${g}</g>
      <text x="${(i % cols) * tileW + 12}" y="${Math.floor(i / cols) * tileH + 26}" font-family="Helvetica" font-size="22" fill="#888">${sv.letter}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#fff"/>${groups}</svg>`;
}

/* ---------- main ---------- */

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(QA, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  // 1. bbox compartilhado + métricas de tinta
  const inputs = [];
  for (const L of LETTERS) {
    const gray = await readGray(path.join(SRC, `${L}.png`));
    inputs.push({ L, gray, bbox: inkBBox(gray) });
  }
  const box = {
    minX: Math.max(0, Math.min(...inputs.map((i) => i.bbox.minX)) - PAD),
    minY: Math.max(0, Math.min(...inputs.map((i) => i.bbox.minY)) - PAD),
    maxX: Math.min(329, Math.max(...inputs.map((i) => i.bbox.maxX)) + PAD),
    maxY: Math.min(251, Math.max(...inputs.map((i) => i.bbox.maxY)) + PAD),
  };
  box.w = box.maxX - box.minX + 1;
  box.h = box.maxY - box.minY + 1;
  log(`bbox compartilhado: ${box.w}x${box.h} @ (${box.minX},${box.minY})`);

  const scale = Math.min(CANVAS.w / box.w, CANVAS.h / box.h);
  const px = { w: Math.round(box.w * scale), h: Math.round(box.h * scale) };
  log(`render da tinta: ${px.w}x${px.h} (fator ${scale.toFixed(2)}x) em ${CANVAS.w}x${CANVAS.h}`);

  // region.png é exatamente metade do canvas: derivado do MESMO raster, garante alinhamento
  const pxLeft = Math.round((CANVAS.w - px.w) / 2);
  const pxTop = Math.round((CANVAS.h - px.h) / 2);

  const metrics = [];
  const sheetItems = [];

  for (const { L, gray } of inputs) {
    const dir = path.join(OUT, L);
    fs.mkdirSync(dir, { recursive: true });

    // vetor
    const pbmPath = path.join(TMP, `${L}.pbm`);
    const rawSvgPath = path.join(TMP, `${L}.svg`);
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
    }).resize(560).png().toFile(path.join(QA, 'regioes', `${L}.png`));

    metrics.push({
      letter: L,
      paths: (rawSvg.match(/<path/g) || []).length,
      regions: rm.regions.length,
      paintable: paintable.length,
      largestPct: +largest.toFixed(1),
      bytes: ['ink.svg', 'ink.png', 'region.png', 'thumb.webp']
        .reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0),
    });
    sheetItems.push({ letter: L, body: rawSvg });
    log(`  ${L} ok`);
  }

  // prancha
  await sharp(Buffer.from(sheet(sheetItems, box))).png().toFile(path.join(QA, 'prancha.png'));

  const total = metrics.reduce((s, m) => s + m.bytes, 0);
  fs.writeFileSync(path.join(QA, 'metrics.json'), JSON.stringify({ box, px, total, metrics }, null, 2));

  log('\nletra  paths  regiões  pintáveis  maior%  peso');
  for (const m of metrics) {
    log(`${m.letter}      ${String(m.paths).padStart(2)}      ${String(m.regions).padStart(2)}        ${String(m.paintable).padStart(2)}       ${String(m.largestPct).padStart(4)}   ${(m.bytes / 1024).toFixed(0)} KB`);
  }
  log(`\ntotal public/letras: ${(total / 1024 / 1024).toFixed(2)} MB`);
  log(`letras com o corpo sem região própria (balde vazaria): ${metrics.filter((m) => m.largestPct < 8).map((m) => m.letter).join(' ') || 'nenhuma'}`);
  log(`prancha: ${path.join(QA, 'prancha.png')} · regiões: ${path.join(QA, 'regioes')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
