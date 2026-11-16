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
  for (const name of ['Pincel', 'Giz de cera', 'Borracha', 'Balde de tinta']) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  for (const name of ['Tamanho pequeno', 'Tamanho médio', 'Tamanho grande']) {
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
  await page.getByRole('button', { name: 'Tamanho grande' }).click();
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
