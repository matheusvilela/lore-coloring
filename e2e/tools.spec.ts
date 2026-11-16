import { expect, test, type Page } from '@playwright/test';

const CANVAS_W = 2048;
const CANVAS_H = 1562;
const REGION_W = 1024;
const REGION_H = 781;

/** Quantos píxeis opacos existem numa camada de canvas. */
async function countPixels(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const canvas = document.querySelector<HTMLCanvasElement>(sel);
    if (!canvas) return -1;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  }, selector);
}

const inkPixels = (page: Page) => countPixels(page, '.layer--ink');
const paintPixels = (page: Page) => countPixels(page, '.layer--paint');

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.sheet')).toBeVisible();
  await expect.poll(() => inkPixels(page), { timeout: 10_000 }).toBeGreaterThan(2000);
}

async function setStrokeSizeT(page: Page, t: number) {
  const btn = page.getByRole('button', { name: 'Tamanho do traço' });
  await btn.click();
  await page.locator('.size-popover__range').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, Math.round(t * 100));
  await btn.click();
}

async function sheetBox(page: Page) {
  const box = (await page.locator('.sheet').boundingBox())!;
  return { box, at: (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const };
}

/** Escolhe, no mapa de regiões, o maior corpo fechado da letra e um ponto bem dentro dele. */
async function findBodyRegion(page: Page, letter: string) {
  return page.evaluate(
    async ({ letter, RW, RH }) => {
      const img = new Image();
      img.src = `/lore-coloring/letras/${letter}/region.png`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = RW;
      canvas.height = RH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, RW, RH);

      const idAt = (x: number, y: number): number => {
        if (x < 0 || y < 0 || x >= RW || y >= RH) return -2;
        const o = (y * RW + x) * 4;
        return data[o + 3] === 0 ? -1 : data[o] | (data[o + 1] << 8);
      };

      const counts = new Map<number, number>();
      const onBorder = new Set<number>();
      for (let y = 0; y < RH; y++) {
        for (let x = 0; x < RW; x++) {
          const id = idAt(x, y);
          if (id < 0) continue;
          counts.set(id, (counts.get(id) ?? 0) + 1);
          if (x === 0 || y === 0 || x === RW - 1 || y === RH - 1) onBorder.add(id);
        }
      }

      let region = -1;
      let area = 0;
      for (const [id, n] of counts) {
        if (!onBorder.has(id) && n > area) {
          region = id;
          area = n;
        }
      }

      // ponto com vizinhança 5×5 inteira da mesma região
      let px = -1;
      let py = -1;
      for (let y = 3; y < RH - 3 && px < 0; y++) {
        for (let x = 3; x < RW - 3; x++) {
          if (idAt(x, y) !== region) continue;
          let clear = true;
          for (let dy = -2; dy <= 2 && clear; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (idAt(x + dx, y + dy) !== region) {
                clear = false;
                break;
              }
            }
          }
          if (clear) {
            px = x;
            py = y;
            break;
          }
        }
      }

      return { region, area, fx: (px + 0.5) / RW, fy: (py + 0.5) / RH };
    },
    { letter, RW: REGION_W, RH: REGION_H },
  );
}

/**
 * Depois de um balde: nenhum píxel pintado fora da região (ou sob a tinta) e
 * todos os píxeis da região encostados na linha preta cobertos — é isso que
 * garante que não sobra costura branca entre o preenchimento e o traço.
 */
async function auditFill(page: Page, letter: string, region: number) {
  return page.evaluate(
    async ({ letter, region, RW, RH, W, H }) => {
      const img = new Image();
      img.src = `/lore-coloring/letras/${letter}/region.png`;
      await img.decode();
      const rc = document.createElement('canvas');
      rc.width = RW;
      rc.height = RH;
      const rg = rc.getContext('2d')!;
      rg.drawImage(img, 0, 0);
      const rdata = rg.getImageData(0, 0, RW, RH).data;
      const idAt = (x: number, y: number): number => {
        if (x < 0 || y < 0 || x >= RW || y >= RH) return -2;
        const o = (y * RW + x) * 4;
        return rdata[o + 3] === 0 ? -1 : rdata[o] | (rdata[o + 1] << 8);
      };

      const paint = document.querySelector<HTMLCanvasElement>('.layer--paint')!;
      const ink = document.querySelector<HTMLCanvasElement>('.layer--ink')!;
      const pd = paint.getContext('2d')!.getImageData(0, 0, W, H).data;
      const kd = ink.getContext('2d')!.getImageData(0, 0, W, H).data;

      let painted = 0;
      let outside = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (pd[(y * W + x) * 4 + 3] === 0) continue;
          painted++;
          const id = idAt(x >> 1, y >> 1);
          if (id !== region && id !== -1) outside++;
        }
      }

      let boundary = 0;
      let covered = 0;
      for (let ry = 0; ry < RH; ry++) {
        for (let rx = 0; rx < RW; rx++) {
          if (idAt(rx, ry) !== region) continue;
          const touchesInk =
            idAt(rx - 1, ry) === -1 ||
            idAt(rx + 1, ry) === -1 ||
            idAt(rx, ry - 1) === -1 ||
            idAt(rx, ry + 1) === -1;
          if (!touchesInk) continue;
          boundary++;
          let ok = true;
          for (let sy = 0; sy < 2 && ok; sy++) {
            for (let sx = 0; sx < 2; sx++) {
              const o = ((ry * 2 + sy) * W + (rx * 2 + sx)) * 4;
              if (pd[o + 3] === 0 && kd[o + 3] === 0) {
                ok = false;
                break;
              }
            }
          }
          if (ok) covered++;
        }
      }

      return { painted, outside, boundary, covered };
    },
    { letter, region, RW: REGION_W, RH: REGION_H, W: CANVAS_W, H: CANVAS_H },
  );
}

/**
 * Fração de píxeis sem cobertura total na faixa central do traço.
 * Pincel = 0 (cor chapada); giz de cera = grão visível (medido: ~0,49).
 */
async function strokeTexture(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.layer--paint')!;
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height);

    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { texture: 1, total: 0 };

    // só a faixa central: as pontas arredondadas do traço não distorcem a conta
    const h = y1 - y0 + 1;
    const ya = y0 + Math.round(h * 0.35);
    const yb = y0 + Math.round(h * 0.65);
    let total = 0;
    let grainy = 0;
    for (let y = ya; y <= yb; y++) {
      for (let x = x0; x <= x1; x++) {
        total++;
        if (data[(y * width + x) * 4 + 3] < 240) grainy++;
      }
    }
    return { texture: grainy / total, total };
  });
}

/** Cor do píxel no centro geográfico da pintura. */
async function centerColor(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.layer--paint')!;
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height);
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] < 250) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    const x = Math.round((x0 + x1) / 2);
    const y = Math.round((y0 + y1) / 2);
    const o = (y * width + x) * 4;
    return { r: data[o], g: data[o + 1], b: data[o + 2], a: data[o + 3] };
  });
}

async function stroke(page: Page, from: readonly [number, number], to: readonly [number, number], steps = 20) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps });
  await page.mouse.up();
}

test('a paleta tem as 24 cores e marca a escolhida', async ({ page }) => {
  await ready(page);

  const swatches = page.locator('.swatch');
  await expect(swatches).toHaveCount(24);

  await page.getByRole('button', { name: 'Cor azul oceano' }).click();
  await expect(page.getByRole('button', { name: 'Cor azul oceano' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Cor vermelho', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // as ferramentas e os tamanhos existem e são acessíveis por nome
  for (const name of ['Pincel', 'Giz de cera', 'Borracha', 'Balde de tinta', 'Mover', 'Tamanho do traço']) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
});

test('o pincel pinta com a cor escolhida', async ({ page }) => {
  await ready(page);
  const { at } = await sheetBox(page);

  await page.getByRole('button', { name: 'Cor azul oceano' }).click();
  await stroke(page, at(0.3, 0.5), at(0.7, 0.5));

  const color = await centerColor(page);
  expect(color.a).toBeGreaterThan(240);
  expect(Math.abs(color.r - 0x00)).toBeLessThan(8);
  expect(Math.abs(color.g - 0x7d)).toBeLessThan(8);
  expect(Math.abs(color.b - 0xa5)).toBeLessThan(8);
});

test('o giz de cera deixa textura e o pincel não', async ({ page }) => {
  await ready(page);
  const { at } = await sheetBox(page);

  await stroke(page, at(0.25, 0.4), at(0.75, 0.4));
  const brush = await strokeTexture(page);
  expect(brush.total).toBeGreaterThan(1000);
  expect(brush.texture).toBeLessThan(0.02);

  await page.getByRole('button', { name: 'Desfazer' }).click();
  await page.getByRole('button', { name: 'Giz de cera' }).click();
  await stroke(page, at(0.25, 0.4), at(0.75, 0.4));

  const crayon = await strokeTexture(page);
  expect(crayon.total).toBeGreaterThan(1000);
  // medido: 0,26 no tamanho médio e 0,31 no grande; o pincel fica em 0,002
  expect(crayon.texture).toBeGreaterThan(0.15);
});

test('a borracha apaga a pintura e nunca a linha preta', async ({ page }) => {
  await ready(page);
  const { at } = await sheetBox(page);

  const inkBefore = await inkPixels(page);
  await stroke(page, at(0.2, 0.35), at(0.8, 0.35));
  const painted = await paintPixels(page);
  expect(painted).toBeGreaterThan(1000);

  await page.getByRole('button', { name: 'Borracha' }).click();
  await setStrokeSizeT(page, 1);
  await stroke(page, at(0.2, 0.35), at(0.8, 0.35));

  const after = await paintPixels(page);
  expect(after).toBeLessThan(painted * 0.2);
  expect(await inkPixels(page)).toBe(inkBefore);
});

test('o balde preenche a região exata, sem vazar e sem costura', async ({ page }) => {
  await ready(page);

  const body = await findBodyRegion(page, 'A');
  expect(body.region).toBeGreaterThanOrEqual(0);
  expect(body.area).toBeGreaterThan(10_000);

  const { at } = await sheetBox(page);
  await page.getByRole('button', { name: 'Balde de tinta' }).click();
  await page.getByRole('button', { name: 'Cor amarelo', exact: true }).click();
  await page.mouse.click(...at(body.fx, body.fy));

  await expect.poll(() => paintPixels(page)).toBeGreaterThan(body.area * 3);

  const audit = await auditFill(page, 'A', body.region);
  expect(audit.painted).toBeGreaterThan(body.area * 3);
  expect(audit.outside).toBe(0);
  expect(audit.boundary).toBeGreaterThan(100);
  expect(audit.covered).toBe(audit.boundary);

  // a cor é a escolhida
  const color = await centerColor(page);
  expect(color.a).toBe(255);
  expect(Math.abs(color.r - 0xff)).toBeLessThan(8);
  expect(Math.abs(color.g - 0xff)).toBeLessThan(8);
  expect(Math.abs(color.b - 0x00)).toBeLessThan(8);
});

test('tocar na linha preta com o balde não pinta nada', async ({ page }) => {
  await ready(page);
  const { at } = await sheetBox(page);
  const inkBefore = await inkPixels(page);

  await page.getByRole('button', { name: 'Balde de tinta' }).click();

  // varre uma faixa vertical no meio da letra: pelo menos um toque cai na linha
  let hits = 0;
  for (let i = 1; i < 12; i++) {
    await page.mouse.click(...at(0.5, i / 12));
    const painted = await paintPixels(page);
    if (painted > 0) {
      hits++;
      await page.getByRole('button', { name: 'Desfazer' }).click();
    }
  }
  expect(hits).toBeGreaterThan(0);
  expect(await inkPixels(page)).toBe(inkBefore);
});

/**
 * Retângulo de traço fino dentro do maior corpo da letra.
 * `outside` fica fora do traço e ainda dentro da região — é o que vaza se o
 * círculo não fechar. O vão do teste de fresta é maior que a tampa redonda
 * do traço (~8 px abertos), sem dilatação extra.
 */
async function findStrokeLoop(page: Page, letter: string, stroke: number) {
  return page.evaluate(
    async ({ letter, RW, RH, stroke }) => {
      const img = new Image();
      img.src = `/lore-coloring/letras/${letter}/region.png`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = RW;
      canvas.height = RH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, RW, RH);
      const idAt = (x: number, y: number): number => {
        if (x < 0 || y < 0 || x >= RW || y >= RH) return -1;
        const o = (y * RW + x) * 4;
        return data[o + 3] === 0 ? -1 : data[o]! | (data[o + 1]! << 8);
      };

      const counts = new Map<number, number>();
      const onBorder = new Set<number>();
      for (let y = 0; y < RH; y++) {
        for (let x = 0; x < RW; x++) {
          const id = idAt(x, y);
          if (id < 0) continue;
          counts.set(id, (counts.get(id) ?? 0) + 1);
          if (x === 0 || y === 0 || x === RW - 1 || y === RH - 1) onBorder.add(id);
        }
      }
      let region = -1;
      let area = 0;
      for (const [id, n] of counts) {
        if (!onBorder.has(id) && n > area) {
          region = id;
          area = n;
        }
      }

      const pad = Math.ceil(stroke / 2) + 12;
      const side = 72;
      const win = Math.ceil((side + pad * 2) / 2);
      let hx = -1;
      let hy = -1;
      outer: for (let y = 1; y + win < RH - 1; y += 3) {
        for (let x = 1; x + win < RW - 1; x += 3) {
          let ok = true;
          for (let dy = 0; dy < win && ok; dy += 3) {
            for (let dx = 0; dx < win; dx += 3) {
              if (idAt(x + dx, y + dy) !== region) ok = false;
            }
          }
          if (!ok) continue;
          for (let dy = 0; dy < win && ok; dy++) {
            for (let dx = 0; dx < win; dx++) {
              if (idAt(x + dx, y + dy) !== region) ok = false;
            }
          }
          if (!ok) continue;
          hx = x;
          hy = y;
          break outer;
        }
      }
      if (hx < 0) return null;

      const x0 = hx * 2 + pad;
      const y0 = hy * 2 + pad;
      const x1 = x0 + side;
      const y1 = y0 + side;
      return {
        region,
        x0,
        y0,
        x1,
        y1,
        gap: stroke + 8,
        inside: { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) },
        outside: { x: Math.round((x0 + x1) / 2), y: y0 - Math.ceil(stroke / 2) - 6 },
      };
    },
    { letter, RW: REGION_W, RH: REGION_H, stroke },
  );
}

async function paintPixel(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.layer--paint')!;
      const d = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data;
      return { r: d[0]!, g: d[1]!, b: d[2]!, a: d[3]! };
    },
    { x, y },
  );
}

function isYellow(pixel: { r: number; g: number; b: number; a: number }) {
  return pixel.a === 255 && pixel.r > 250 && pixel.g > 250 && pixel.b < 8;
}

/**
 * Colunas em que um vão claro separa o preenchimento do traço.
 * Varre de dentro do laço para fora, numa faixa que só cruza a borda de cima.
 */
async function whiteSeamColumns(page: Page, x0: number, x1: number, yFrom: number, yTo: number) {
  return page.evaluate(
    ({ x0, x1, yFrom, yTo }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('.layer--paint')!;
      const ctx = canvas.getContext('2d')!;
      const left = Math.min(x0, x1);
      const width = Math.abs(x1 - x0) + 1;
      const top = Math.min(yFrom, yTo);
      const height = Math.abs(yTo - yFrom) + 1;
      const data = ctx.getImageData(left, top, width, height).data;
      const yStart = yFrom - top;
      const yEnd = yTo - top;
      const step = yEnd < yStart ? -1 : 1;
      let seams = 0;
      for (let x = 0; x < width; x++) {
        let sawPaint = false;
        let sawGap = false;
        for (let y = yStart; step > 0 ? y <= yEnd : y >= yEnd; y += step) {
          const a = data[(y * width + x) * 4 + 3]!;
          if (a >= 200) {
            if (sawGap) {
              seams++;
              break;
            }
            sawPaint = true;
          } else if (sawPaint && a < 32) {
            sawGap = true;
          }
        }
      }
      return seams;
    },
    { x0, x1, yFrom, yTo },
  );
}

test('o balde para no traço fechado e segue um vão', async ({ page }) => {
  test.setTimeout(60_000);
  await ready(page);
  await setStrokeSizeT(page, 0);
  const strokePx = 14;

  const loop = await findStrokeLoop(page, 'A', strokePx);
  expect(loop).not.toBeNull();
  const inkBox = () => page.locator('.layer--ink').boundingBox();
  const atPx = async (x: number, y: number) => {
    const box = (await inkBox())!;
    return [box.x + (x / CANVAS_W) * box.width, box.y + (y / CANVAS_H) * box.height] as const;
  };

  const drawRect = async (closeTop: boolean) => {
    const { x0, y0, x1, y1, gap } = loop!;
    const topEnd = closeTop ? x1 : x1 - gap;
    await stroke(page, await atPx(x0, y0), await atPx(topEnd, y0));
    await stroke(page, await atPx(x1, y0), await atPx(x1, y1));
    await stroke(page, await atPx(x1, y1), await atPx(x0, y1));
    await stroke(page, await atPx(x0, y1), await atPx(x0, y0));
  };

  await drawRect(true);
  await page.getByRole('button', { name: 'Balde de tinta' }).click();
  await page.getByRole('button', { name: 'Cor amarelo', exact: true }).click();
  await page.mouse.click(...(await atPx(loop!.inside.x, loop!.inside.y)));

  await expect.poll(() => paintPixel(page, loop!.inside.x, loop!.inside.y).then(isYellow)).toBe(true);
  expect(await paintPixel(page, loop!.outside.x, loop!.outside.y)).toMatchObject({ a: 0 });
  expect(await whiteSeamColumns(page, loop!.x0 + 16, loop!.x1 - 16, loop!.inside.y, loop!.outside.y)).toBe(0);

  // o toque fica no histórico: depois de recarregar o vão continua vazio
  await page.waitForTimeout(950);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(50);
  await page.reload();
  await expect.poll(() => inkPixels(page), { timeout: 10_000 }).toBeGreaterThan(2000);
  await expect.poll(() => paintPixel(page, loop!.inside.x, loop!.inside.y).then(isYellow)).toBe(true);
  expect(await paintPixel(page, loop!.outside.x, loop!.outside.y)).toMatchObject({ a: 0 });
  expect(await whiteSeamColumns(page, loop!.x0 + 16, loop!.x1 - 16, loop!.inside.y, loop!.outside.y)).toBe(0);

  const undo = page.getByRole('button', { name: 'Desfazer' });
  await undo.click();
  expect((await paintPixel(page, loop!.inside.x, loop!.inside.y)).a).toBe(0);
  expect((await paintPixel(page, loop!.outside.x, loop!.outside.y)).a).toBe(0);

  for (let i = 0; i < 4; i++) await undo.click();
  expect(await paintPixels(page)).toBe(0);

  await page.getByRole('button', { name: 'Pincel' }).click();
  await page.getByRole('button', { name: 'Cor amarelo', exact: true }).click();
  await setStrokeSizeT(page, 0);
  const { x0, y0, x1, y1, gap } = loop!;
  await stroke(page, await atPx(x0, y0), await atPx(x1 - gap, y0));
  await stroke(page, await atPx(x1, y0), await atPx(x1, y1));
  await stroke(page, await atPx(x1, y1), await atPx(x0, y1));
  await stroke(page, await atPx(x0, y1), await atPx(x0, y0));

  await page.getByRole('button', { name: 'Balde de tinta' }).click();
  await page.mouse.click(...(await atPx(loop!.inside.x, loop!.inside.y)));
  await expect.poll(() => paintPixel(page, loop!.outside.x, loop!.outside.y).then(isYellow)).toBe(true);

  for (let i = 0; i < 5; i++) await undo.click();
  expect(await paintPixels(page)).toBe(0);

  // o grão do giz não é furo: o balde continua preso no laço
  await page.getByRole('button', { name: 'Giz de cera' }).click();
  await setStrokeSizeT(page, 0);
  await stroke(page, await atPx(x0, y0), await atPx(x1, y0));
  await stroke(page, await atPx(x1, y0), await atPx(x1, y1));
  await stroke(page, await atPx(x1, y1), await atPx(x0, y1));
  await stroke(page, await atPx(x0, y1), await atPx(x0, y0));
  await page.getByRole('button', { name: 'Balde de tinta' }).click();
  await page.mouse.click(...(await atPx(loop!.inside.x, loop!.inside.y)));
  await expect.poll(() => paintPixel(page, loop!.inside.x, loop!.inside.y).then(isYellow)).toBe(true);
  expect(await paintPixel(page, loop!.outside.x, loop!.outside.y)).toMatchObject({ a: 0 });
});

test('desfazer volta o balde e a borracha junto', async ({ page }) => {
  await ready(page);
  const { at } = await sheetBox(page);
  const undo = page.getByRole('button', { name: 'Desfazer' });

  const body = await findBodyRegion(page, 'A');
  await page.getByRole('button', { name: 'Balde de tinta' }).click();
  await page.mouse.click(...at(body.fx, body.fy));
  expect(await paintPixels(page)).toBeGreaterThan(10_000);

  await undo.click();
  expect(await paintPixels(page)).toBe(0);
  await expect(undo).toBeDisabled();

  // a borracha também entra no histórico: desfazer devolve o que ela apagou
  await page.getByRole('button', { name: 'Pincel' }).click();
  await stroke(page, at(0.3, 0.45), at(0.7, 0.45));
  const drawn = await paintPixels(page);
  expect(drawn).toBeGreaterThan(1000);

  await page.getByRole('button', { name: 'Borracha' }).click();
  await stroke(page, at(0.3, 0.45), at(0.7, 0.45));
  expect(await paintPixels(page)).toBeLessThan(drawn * 0.2);

  await undo.click();
  expect(await paintPixels(page)).toBe(drawn);
});
