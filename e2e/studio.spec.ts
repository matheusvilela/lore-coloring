import { expect, test, type Page } from '@playwright/test';

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

test('pinta, desfaz e navega entre as letras', async ({ page }) => {
  await page.goto('/');

  const sheet = page.locator('.sheet');
  await expect(sheet).toBeVisible();

  // a tinta da letra A precisa estar carregada antes de pintar
  await expect.poll(() => inkPixels(page), { timeout: 10_000 }).toBeGreaterThan(2000);
  expect(await paintPixels(page)).toBe(0);

  const undo = page.getByRole('button', { name: 'Desfazer' });
  await expect(undo).toBeDisabled();

  const box = (await sheet.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx - box.width * 0.2, cy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    await page.mouse.move(cx - box.width * 0.2 + box.width * 0.4 * t, cy + Math.sin(t * Math.PI * 2) * 30);
  }
  await page.mouse.up();

  const painted = await paintPixels(page);
  expect(painted).toBeGreaterThan(1000);
  await expect(undo).toBeEnabled();

  await undo.click();
  expect(await paintPixels(page)).toBe(0);
  await expect(undo).toBeDisabled();

  // navegação
  await expect(page.locator('.letter-status')).toHaveText('A');
  await page.getByRole('button', { name: 'Próxima letra' }).click();
  await expect(page.locator('.letter-status')).toHaveText('B');
  await expect.poll(() => inkPixels(page), { timeout: 10_000 }).toBeGreaterThan(2000);

  // ao trocar de letra a pintura some (cada letra tem sua tela)
  expect(await paintPixels(page)).toBe(0);

  await page.getByRole('button', { name: 'Letra anterior' }).click();
  await expect(page.locator('.letter-status')).toHaveText('A');

  const next = page.getByRole('button', { name: 'Próxima letra' });
  const prev = page.getByRole('button', { name: 'Letra anterior' });
  for (let i = 0; i < 25; i++) await next.click();
  await expect(page.locator('.letter-status')).toHaveText('Z');
  await next.click();
  await expect(page.locator('.letter-status')).toHaveText('A');
  await prev.click();
  await expect(page.locator('.letter-status')).toHaveText('Z');
});

test('desfazer remove um traço depois de voltar à letra', async ({ page }) => {
  await page.goto('/');

  const sheet = page.locator('.sheet');
  await expect.poll(() => inkPixels(page), { timeout: 10_000 }).toBeGreaterThan(2000);

  const box = (await sheet.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const drawStroke = async (yOffset: number) => {
    await page.mouse.move(cx - box.width * 0.2, cy + yOffset);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      await page.mouse.move(
        cx - box.width * 0.2 + box.width * 0.4 * t,
        cy + yOffset + Math.sin(t * Math.PI * 2) * 30,
      );
    }
    await page.mouse.up();
  };

  await drawStroke(-40);
  await drawStroke(40);

  const bothStrokes = await paintPixels(page);
  expect(bothStrokes).toBeGreaterThan(2000);

  const undo = page.getByRole('button', { name: 'Desfazer' });
  await expect(undo).toBeEnabled();

  await page.getByRole('button', { name: 'Próxima letra' }).click();
  await expect(page.locator('.letter-status')).toHaveText('B');
  await expect.poll(() => inkPixels(page), { timeout: 10_000 }).toBeGreaterThan(2000);

  await page.getByRole('button', { name: 'Letra anterior' }).click();
  await expect(page.locator('.letter-status')).toHaveText('A');
  await expect.poll(() => paintPixels(page), { timeout: 10_000 }).toBe(bothStrokes);
  await expect(undo).toBeEnabled();

  await undo.click();
  const afterOneUndo = await paintPixels(page);
  expect(afterOneUndo).toBeGreaterThan(500);
  expect(afterOneUndo).toBeLessThan(bothStrokes);
  await expect(undo).toBeEnabled();

  await undo.click();
  expect(await paintPixels(page)).toBe(0);
  await expect(undo).toBeDisabled();
});

test('a tinta nunca é alterada pela pintura', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => inkPixels(page), { timeout: 10_000 }).toBeGreaterThan(2000);
  const before = await inkPixels(page);

  const box = (await page.locator('.sheet').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 20 });
  await page.mouse.up();

  expect(await inkPixels(page)).toBe(before);
});
