import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.sheet')).toBeVisible();
  await expect.poll(() => inkPixels(page), { timeout: 10_000 }).toBeGreaterThan(2000);
}

/** Quantos píxeis opacos existem numa camada de canvas. */
function countPixels(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const canvas = document.querySelector<HTMLCanvasElement>(sel)!;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  }, selector);
}

const inkPixels = (page: Page) => countPixels(page, '.layer--ink');
const paintPixels = (page: Page) => countPixels(page, '.layer--paint');

/**
 * Pinça sintética: os dedos são PointerEvents despachados no palco (e não na
 * folha), então o `Painter` nem chega a ver o primeiro toque — o teste mede só
 * o gesto de zoom.
 */
async function pinch(page: Page, from: number, to: number) {
  const box = (await page.locator('.sheet').boundingBox())!;
  await page.evaluate(
    ({ from, to, cx, cy }) => {
      const stage = document.querySelector('.stage')!;
      const fire = (type: string, id: number, x: number, y: number, target: EventTarget) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            isPrimary: id === 11,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );

      fire('pointerdown', 11, cx - from / 2, cy, stage);
      fire('pointerdown', 12, cx + from / 2, cy, stage);
      fire('pointermove', 11, cx - to / 2, cy, window);
      fire('pointermove', 12, cx + to / 2, cy, window);
      fire('pointerup', 11, cx - to / 2, cy, window);
      fire('pointerup', 12, cx + to / 2, cy, window);
    },
    { from, to, cx: box.x + box.width / 2, cy: box.y + box.height / 2 },
  );
}

function sheetBox(page: Page) {
  return page.locator('.sheet').evaluate((el) => ({
    transform: (el as HTMLElement).style.transform,
    width: el.getBoundingClientRect().width,
    height: el.getBoundingClientRect().height,
  }));
}

test('a pinça amplia a folha sem pintar nem tocar na tinta', async ({ page }) => {
  await ready(page);
  const inkBefore = await inkPixels(page);

  const before = await sheetBox(page);
  expect(before.transform).toBe('');

  await pinch(page, 120, 380);

  const after = await sheetBox(page);
  expect(after.width / before.width).toBeGreaterThan(2.5);
  expect(after.transform).toContain('scale(');

  // o traço acidental do primeiro dedo é cancelado: pinça não pinta
  expect(await paintPixels(page)).toBe(0);
  expect(await inkPixels(page)).toBe(inkBefore);
});

test('com zoom, o traço cai no lugar certo do canvas', async ({ page }) => {
  await ready(page);
  await pinch(page, 120, 360);

  const box = (await page.locator('.sheet').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();

  const painted = await page.evaluate(() => {
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
    return { x: (x0 + x1) / 2 / width, y: (y0 + y1) / 2 / height };
  });

  // o centro da folha continua sendo o centro do canvas
  expect(Math.abs(painted.x - 0.5)).toBeLessThan(0.06);
  expect(Math.abs(painted.y - 0.5)).toBeLessThan(0.06);
});

test('com o balde, a pinça não preenche nada', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'celular', 'precisa de toque real (CDP)');

  await ready(page);
  await page.getByRole('button', { name: 'Balde de tinta' }).click();

  const box = (await page.locator('.sheet').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const cdp = await context.newCDPSession(page);
  const touch = (type: string, points: Array<{ x: number; y: number; id: number }>) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });

  // primeiro dedo encosta na folha (o balde fica pendente), segundo dedo inicia a pinça
  await touch('touchStart', [{ x: cx, y: cy, id: 1 }]);
  await touch('touchStart', [
    { x: cx - 60, y: cy, id: 1 },
    { x: cx + 60, y: cy, id: 2 },
  ]);
  await touch('touchMove', [
    { x: cx - 120, y: cy, id: 1 },
    { x: cx + 120, y: cy, id: 2 },
  ]);
  await touch('touchEnd', []);

  const after = await sheetBox(page);
  expect(after.width).toBeGreaterThan(box.width * 1.8);
  // o toque do primeiro dedo foi cancelado: nenhuma região pintada
  expect(await paintPixels(page)).toBe(0);
});

test('após voltar numa letra salva, a pinça não apaga a pintura', async ({ page }) => {
  await ready(page);

  const sheet = page.locator('.sheet');
  const box = (await sheet.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    await page.mouse.move(cx - box.width * 0.15 + box.width * 0.3 * t, cy + Math.sin(t * Math.PI * 4) * 40);
  }
  await page.mouse.up();

  const painted = await paintPixels(page);
  expect(painted).toBeGreaterThan(800);
  await page.waitForTimeout(900);

  await page.getByRole('button', { name: 'Próxima letra' }).click();
  await expect(page.locator('.letter-status')).toHaveText('B');
  await page.getByRole('button', { name: 'Letra anterior' }).click();
  await expect(page.locator('.letter-status')).toHaveText('A');
  await expect.poll(() => paintPixels(page), { timeout: 10_000 }).toBeGreaterThan(800);

  // primeiro dedo na tinta (como no uso real); pinça cancela o traço sem zombar do replay
  await page.evaluate(
    ({ cx, cy }) => {
      const ink = document.querySelector('.layer--ink')!;
      const fire = (type: string, id: number, x: number, y: number, target: EventTarget) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            isPrimary: id === 21,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );

      fire('pointerdown', 21, cx, cy, ink);
      fire('pointerdown', 22, cx + 80, cy, ink);
      fire('pointermove', 21, cx - 60, cy, window);
      fire('pointermove', 22, cx + 120, cy, window);
      fire('pointerup', 21, cx - 60, cy, window);
      fire('pointerup', 22, cx + 120, cy, window);
    },
    { cx, cy },
  );

  expect(await paintPixels(page)).toBeGreaterThan(800);
});

test('botões de zoom no dock ajustam a folha', async ({ page }) => {
  await ready(page);
  expect((await sheetBox(page)).transform).toBe('');

  await page.getByRole('button', { name: 'Zoom mais' }).click();
  await expect
    .poll(async () => (await sheetBox(page)).transform)
    .not.toBe('');

  await page.getByRole('button', { name: 'Restaurar zoom original' }).click();
  expect((await sheetBox(page)).transform).toBe('');
});

test('a tecla 0 volta ao encaixe; trocar de letra mantém o zoom', async ({ page }) => {
  await ready(page);
  await pinch(page, 120, 380);
  expect((await sheetBox(page)).transform).not.toBe('');

  await page.keyboard.press('0');
  expect((await sheetBox(page)).transform).toBe('');

  await pinch(page, 120, 380);
  const zoomed = await sheetBox(page);
  expect(zoomed.transform).not.toBe('');

  await page.getByRole('button', { name: 'Próxima letra' }).click();
  await expect(page.locator('.letter-status')).toHaveText('B');
  expect((await sheetBox(page)).transform).toBe(zoomed.transform);
});
