/**
 * Prova de recorte: remonta a folha a partir dos 40 PNGs e mostra em vermelho
 * cada pixel de tinta que nenhum recorte levou (deve ser só o ruído < 8 px).
 */
import sharp from 'sharp';
import fs from 'node:fs';

const { canvas: [CW, CHh], folha: [W, H], letras } = JSON.parse(
  fs.readFileSync('_qa/coreano/recortes.json', 'utf8'),
);
const { data: src, info } = await sharp('assets-src/coreano/sheet.png').raw().toBuffer({ resolveWithObject: true });
const CH = info.channels;

const covered = new Uint8Array(W * H);
for (const l of letras) {
  const { data, info: mi } = await sharp(`assets-src/coreano/${l.name}.png`).raw().toBuffer({ resolveWithObject: true });
  if (mi.width !== CW || mi.height !== CHh) throw new Error(`canvas diferente: ${l.name}`);
  const [bx0, by0, bx1, by1] = l.box;
  const ox = Math.round((CW - (bx1 - bx0 + 1)) / 2);
  const oy = Math.round((CHh - (by1 - by0 + 1)) / 2);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const co = ((y - by0 + oy) * CW + (x - bx0 + ox)) * mi.channels;
      if (data[co] < 245 || data[co + 1] < 245 || data[co + 2] < 245) covered[y * W + x] = 1;
    }
  }
}

const out = Buffer.alloc(W * H * 3, 255);
let lost = 0, ink = 0;
const spots = [];
for (let i = 0; i < W * H; i++) {
  const o = i * CH;
  const isInk = src[o] < 245 || src[o + 1] < 245 || src[o + 2] < 245;
  if (isInk) ink++;
  if (isInk && !covered[i]) {
    lost++;
    if (spots.length < 20) spots.push(`(${i % W},${(i / W) | 0})`);
    out[i * 3] = 255;
  } else if (covered[i]) {
    out[i * 3] = 205; out[i * 3 + 1] = 205; out[i * 3 + 2] = 205;
  }
}
await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile('_qa/coreano/reconstrucao.png');
console.log(`tinta na folha: ${ink}px · não coberta: ${lost}px (${((lost / ink) * 100).toFixed(3)}%)`);
if (lost) console.log('primeiros pixels perdidos:', spots.join(' '));
