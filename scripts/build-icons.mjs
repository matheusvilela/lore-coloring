#!/usr/bin/env node
/**
 * Ícone PWA: SVG colorido da letra A + PNGs para favicon / Apple / manifest.
 *
 * Fontes: assets-src/letras/A.png, public/letras/A/ink.svg (mesma lógica de
 * região que scripts/build-assets.mjs).
 *
 * Uso: node scripts/build-icons.mjs
 * Requer: potrace e sharp.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'assets-src/letras/A.png');
const INK_SVG = path.join(ROOT, 'public/letras/A/ink.svg');
const OUT_DIR = path.join(ROOT, 'public');
const ICONS_DIR = path.join(OUT_DIR, 'icons');
const TMP = path.join(ROOT, '.tmp-icons');

const THRESHOLD = 128;
/** bbox compartilhado das 26 letras — igual ao em _qa/metrics.json após build:assets */
const BOX = { minX: 10, minY: 10, w: 309, h: 231 };

const COLORS = {
  body: '#D24545',
  mouth: ['#F5A05F', '#FFFF00', '#88C170', '#007DA5'],
  eye: '#FFFFFF',
  pupil: '#000000',
};

const log = (...a) => console.log(...a);

async function readGray(file) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function regionMap(data, w, h, isBarrier) {
  const n = w * h;
  const labels = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const regions = [];

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || isBarrier(start)) continue;
    const id = regions.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    let area = 0;
    let touchesBorder = false;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    let sx = 0, sy = 0;

    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i / w) | 0;
      area++;
      sx += x;
      sy += y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && !isBarrier(i - 1) && labels[i - 1] === -1) {
        labels[i - 1] = id;
        stack[sp++] = i - 1;
      }
      if (x < w - 1 && !isBarrier(i + 1) && labels[i + 1] === -1) {
        labels[i + 1] = id;
        stack[sp++] = i + 1;
      }
      if (y > 0 && !isBarrier(i - w) && labels[i - w] === -1) {
        labels[i - w] = id;
        stack[sp++] = i - w;
      }
      if (y < h - 1 && !isBarrier(i + w) && labels[i + w] === -1) {
        labels[i + w] = id;
        stack[sp++] = i + w;
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    regions.push({
      id,
      area,
      touchesBorder,
      minX,
      minY,
      maxX,
      maxY,
      bw,
      bh,
      cx: sx / area,
      cy: sy / area,
      aspect: bh / Math.max(bw, 1),
    });
  }
  return { labels, regions, w, h };
}

function regionMask(labels, regionId, w, h, dilate = 0) {
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (labels[i] === regionId) on[i] = 1;
  }
  if (dilate > 0) {
    const grown = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!on[y * w + x]) continue;
        for (let dy = -dilate; dy <= dilate; dy++) {
          for (let dx = -dilate; dx <= dilate; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) grown[ny * w + nx] = 1;
          }
        }
      }
    }
    return grown;
  }
  return on;
}

function maskToPBM(mask, w, h) {
  const rowBytes = Math.ceil(w / 8);
  const buf = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      buf[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([Buffer.from(`P4\n${w} ${h}\n`), buf]);
}

function regionPBM(labels, regionId, w, h, dilate = 0) {
  return maskToPBM(regionMask(labels, regionId, w, h, dilate), w, h);
}

function trace(pbmPath, svgPath) {
  execFileSync(
    'potrace',
    ['-s', '-o', svgPath, '--turdsize', '2', '--alphamax', '1', '--opttolerance', '0.2', pbmPath],
    { stdio: 'pipe' },
  );
}

function patchSvg(raw, box, px) {
  const body = raw
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')
    .trim();
  const root = `<svg xmlns="http://www.w3.org/2000/svg" width="${px.w}" height="${px.h}" viewBox="${box.minX} ${box.minY} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet">`;
  return body.replace(/<svg[^>]*>/, root);
}

function inkGroupFromInkSvg(inkRaw) {
  const m = inkRaw.match(/<g[\s\S]*<\/g>/);
  if (!m) return '';
  return m[0].replace('<g transform=', '<g class="ink" transform=');
}

function fillColorForRegion(r, buckets) {
  if (r.id === buckets.body?.id) return COLORS.body;
  if (buckets.pupils.some((p) => p.id === r.id)) return COLORS.pupil;
  if (buckets.mouth.some((m) => m.id === r.id)) {
    const idx = buckets.mouth.findIndex((m) => m.id === r.id);
    return COLORS.mouth[idx] ?? COLORS.body;
  }
  return null;
}

function classifyRegions(regions, w, h) {
  const interior = regions.filter((r) => !r.touchesBorder);
  const minArea = w * h * 0.002;
  const paintable = interior.filter((r) => r.area >= minArea);

  const body = paintable.reduce((best, r) => (r.area > best.area ? r : best), paintable[0]);

  const mouthCandidates = paintable.filter(
    (r) => r.id !== body.id && r.aspect >= 2.2 && r.bw / w < 0.06 && r.bh / h > 0.08,
  );
  const mouth = [...mouthCandidates].sort((a, b) => a.cx - b.cx).slice(0, 4);

  const pupils = interior.filter(
    (r) =>
      r.id !== body.id &&
      !mouth.some((m) => m.id === r.id) &&
      r.area >= 40 &&
      r.area < minArea &&
      r.bw / w < 0.06 &&
      r.bh / h < 0.05 &&
      r.cy / h > 0.36 &&
      r.cy / h < 0.44,
  );

  const eyeSlices = paintable.filter(
    (r) =>
      r.id !== body.id &&
      !mouth.some((m) => m.id === r.id) &&
      r.bw / w > 0.08 &&
      r.bw / w < 0.15 &&
      r.bh / h < 0.08 &&
      r.aspect < 1.6,
  );
  const leftEyeIds = eyeSlices.filter((r) => r.cx / w < 0.45).map((r) => r.id);
  const rightEyeIds = eyeSlices.filter((r) => r.cx / w > 0.55).map((r) => r.id);

  const skipEye = new Set([...leftEyeIds, ...rightEyeIds]);
  const paintableNoEyes = paintable.filter((r) => !skipEye.has(r.id));
  const traceable = [
    ...paintableNoEyes,
    ...pupils.filter((p) => !paintable.some((x) => x.id === p.id)),
  ];

  return { body, mouth, pupils, leftEyeIds, rightEyeIds, paintable: traceable };
}

/** Recorta pálpebra (vermelho) e esclera (branco) por olho, ~45% de cima para baixo. */
function eyeSplitPBM(labels, ids, w, h, lidRatio = 0.45) {
  let minY = h;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = labels[y * w + x];
      if (!ids.includes(id)) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const splitY = minY + (maxY - minY + 1) * lidRatio;
  const rowBytes = Math.ceil(w / 8);
  const lid = Buffer.alloc(rowBytes * h);
  const white = Buffer.alloc(rowBytes * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = labels[y * w + x];
      if (!ids.includes(id)) continue;
      const bit = 0x80 >> (x & 7);
      const o = y * rowBytes + (x >> 3);
      if (y < splitY) lid[o] |= bit;
      else white[o] |= bit;
    }
  }
  return {
    lid: Buffer.concat([Buffer.from(`P4\n${w} ${h}\n`), lid]),
    white: Buffer.concat([Buffer.from(`P4\n${w} ${h}\n`), white]),
  };
}

async function traceColoredMask(pbm, color, name, px) {
  const pbmPath = path.join(TMP, `${name}.pbm`);
  const rawSvgPath = path.join(TMP, `${name}.svg`);
  fs.writeFileSync(pbmPath, pbm);
  trace(pbmPath, rawSvgPath);
  const patched = patchSvg(fs.readFileSync(rawSvgPath, 'utf8'), BOX, px);
  return pathsFromTracedSvg(patched, color);
}

function colorizeInkGroup(inkGroup) {
  return inkGroup;
}

function pathsFromTracedSvg(patched, fill) {
  const gMatch = patched.match(/<g[\s\S]*<\/g>/);
  if (!gMatch) return [];
  const paths = [...gMatch[0].matchAll(/<path[\s\S]*?\/>/g)].map((m) => m[0]);
  return paths.map((p) =>
    p.includes('fill=') ? p.replace(/fill="[^"]*"/, `fill="${fill}"`) : p.replace('<path ', `<path fill="${fill}" `),
  );
}

async function buildColoredPaths(labels, buckets, w, h, px) {
  const base = [];
  const overlay = [];
  const seen = new Set();

  for (const r of buckets.paintable) {
    if (buckets.pupils.some((p) => p.id === r.id)) continue;
    const fill = fillColorForRegion(r, buckets);
    if (!fill || seen.has(r.id)) continue;
    seen.add(r.id);

    const pbmPath = path.join(TMP, `region-${r.id}.pbm`);
    const rawSvgPath = path.join(TMP, `region-${r.id}.svg`);
    fs.writeFileSync(pbmPath, regionPBM(labels, r.id, w, h));
    trace(pbmPath, rawSvgPath);
    const patched = patchSvg(fs.readFileSync(rawSvgPath, 'utf8'), BOX, px);
    base.push(...pathsFromTracedSvg(patched, fill));
  }

  for (const [side, ids] of [
    ['eye-left', buckets.leftEyeIds],
    ['eye-right', buckets.rightEyeIds],
  ]) {
    if (ids.length === 0) continue;
    const { lid, white } = eyeSplitPBM(labels, ids, w, h);
    const lidPaths = await traceColoredMask(lid, COLORS.body, `${side}-lid`, px);
    const whitePaths = await traceColoredMask(white, COLORS.eye, `${side}-white`, px);
    base.push(...lidPaths, ...whitePaths);
    overlay.push(...lidPaths);
  }

  for (const r of buckets.pupils) {
    const pbmPath = path.join(TMP, `region-${r.id}.pbm`);
    const rawSvgPath = path.join(TMP, `region-${r.id}.svg`);
    fs.writeFileSync(pbmPath, regionPBM(labels, r.id, w, h, 2));
    trace(pbmPath, rawSvgPath);
    const patched = patchSvg(fs.readFileSync(rawSvgPath, 'utf8'), BOX, px);
    const pupilPaths = pathsFromTracedSvg(patched, COLORS.pupil);
    base.push(...pupilPaths);
    overlay.push(...pupilPaths);
  }

  return { base, overlay };
}

const POTRACE_G =
  '<g class="fills" transform="translate(0.000000,251.000000) scale(0.100000,-0.100000)" fill="#000000" stroke="none">';

async function composeSvg({ base, overlay }, inkGroup) {
  const viewBox = `${BOX.minX} ${BOX.minY} ${BOX.w} ${BOX.h}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${BOX.w}" height="${BOX.h}" preserveAspectRatio="xMidYMid meet">
${POTRACE_G}
${base.map((p) => `  ${p}`).join('\n')}
</g>
${colorizeInkGroup(inkGroup)}
${POTRACE_G.replace('class="fills"', 'class="fills-overlay"')}
${overlay.map((p) => `  ${p}`).join('\n')}
</g>
</svg>`;
}

async function rasterizeIcon(svg, size, safe) {
  const inner = Math.round(size * safe);
  const rendered = await sharp(Buffer.from(svg), { density: 300 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const meta = await sharp(rendered).metadata();
  const rw = meta.width;
  const rh = meta.height;
  const left = Math.round((size - rw) / 2);
  const top = Math.round((size - rh) / 2);

  return sharp({
    create: { width: size, height: size, channels: 4, background: '#ffffff' },
  })
    .composite([{ input: rendered, left, top }])
    .png({ compressionLevel: 9 });
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`fonte não encontrada: ${SRC}`);
  if (!fs.existsSync(INK_SVG)) throw new Error(`tinta não encontrada: ${INK_SVG}`);

  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const { data, w, h } = await readGray(SRC);
  const isBarrier = (i) => data[i] < THRESHOLD;
  const { labels, regions } = regionMap(data, w, h, isBarrier);
  const buckets = classifyRegions(regions, w, h);

  log(
    `regiões pintáveis: ${buckets.paintable.length} · corpo ${buckets.body?.area} · boca ${buckets.mouth.length} · olhos L/R ${buckets.leftEyeIds.length}/${buckets.rightEyeIds.length} · pupilas ${buckets.pupils.length}`,
  );
  if (buckets.mouth.length !== 4) {
    console.warn(`aviso: esperava 4 barras da boca, achei ${buckets.mouth.length}`);
  }

  const px = { w: BOX.w, h: BOX.h };
  const fillLayers = await buildColoredPaths(labels, buckets, w, h, px);
  const inkGroup = inkGroupFromInkSvg(fs.readFileSync(INK_SVG, 'utf8'));
  const svg = await composeSvg(fillLayers, inkGroup);

  const iconSvgPath = path.join(OUT_DIR, 'icon.svg');
  fs.writeFileSync(iconSvgPath, svg);
  log(`wrote ${iconSvgPath}`);

  await (await rasterizeIcon(svg, 32, 0.8)).toFile(path.join(OUT_DIR, 'favicon-32.png'));
  await (await rasterizeIcon(svg, 180, 0.8)).toFile(path.join(OUT_DIR, 'apple-touch-icon.png'));
  await (await rasterizeIcon(svg, 192, 0.8)).toFile(path.join(ICONS_DIR, 'icon-192.png'));
  await (await rasterizeIcon(svg, 512, 0.8)).toFile(path.join(ICONS_DIR, 'icon-512.png'));
  await (await rasterizeIcon(svg, 192, 0.66)).toFile(path.join(ICONS_DIR, 'icon-maskable-192.png'));
  await (await rasterizeIcon(svg, 512, 0.66)).toFile(path.join(ICONS_DIR, 'icon-maskable-512.png'));

  log('ícones PNG ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});