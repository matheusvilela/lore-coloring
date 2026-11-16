import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

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

const paintPixels = (page: Page) => countPixels(page, '.layer--paint');

test('restaura a pintura depois de recarregar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'IndexedDB compartilhado: um worker por vez');
  await page.goto('/');
  await expect.poll(() => countPixels(page, '.layer--ink')).toBeGreaterThan(2000);

  const sheet = page.locator('.sheet');
  const box = (await sheet.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx - 80, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy, { steps: 16 });
  await page.mouse.up();

  await expect.poll(() => paintPixels(page)).toBeGreaterThan(1000);
  await page.waitForTimeout(950);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(50);

  await page.reload();
  await expect.poll(() => countPixels(page, '.layer--ink')).toBeGreaterThan(2000);
  await expect.poll(() => paintPixels(page), { timeout: 10_000 }).toBeGreaterThan(500);
});

test('do Z a próxima ação abre a grade', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Grade de letras' }).click();
  await expect(page.getByRole('region', { name: 'Grade de letras' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar ao desenho' }).click();
  await expect(page.locator('.sheet')).toBeVisible();
});

test('na grade o contorno da letra fica acima da pintura', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => countPixels(page, '.layer--ink')).toBeGreaterThan(2000);

  const sheet = page.locator('.sheet');
  const box = (await sheet.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.getByRole('button', { name: 'Balde de tinta' }).click();
  await page.getByRole('button', { name: 'Cor amarelo', exact: true }).click();
  await page.mouse.click(cx, cy);

  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Grade de letras' }).click();
  await expect(page.getByRole('region', { name: 'Grade de letras' })).toBeVisible();

  const cell = page.locator('.letter-cell').first();
  await expect(cell.locator('.letter-cell__paint')).toBeVisible();

  const layers = await cell.evaluate(() => {
    const ink = document.querySelector('.letter-cell__ink')!;
    const paint = document.querySelector('.letter-cell__paint')!;
    return {
      inkZ: getComputedStyle(ink).zIndex,
      paintZ: getComputedStyle(paint).zIndex,
    };
  });
  expect(Number(layers.inkZ)).toBeGreaterThan(Number(layers.paintZ));
  await expect(cell.locator('.letter-cell__ink')).toBeVisible();
});

test('limpar letra na grade apaga só aquela célula', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => countPixels(page, '.layer--ink')).toBeGreaterThan(2000);

  const sheet = page.locator('.sheet');
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    await page.mouse.move(box.x + box.width * 0.3 * t, box.y + box.height / 2);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);

  await page.getByRole('button', { name: 'Grade de letras' }).click();
  const cell = page.getByRole('button', { name: 'Letra A' });
  await expect(cell.locator('.letter-cell__paint')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar letra A' }).click();
  await expect(cell.locator('.letter-cell__paint')).toHaveCount(0);
});

test('a tinta volta ao escolher letra na grade', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => countPixels(page, '.layer--ink')).toBeGreaterThan(2000);

  await page.getByRole('button', { name: 'Grade de letras' }).click();
  await expect(page.getByRole('region', { name: 'Grade de letras' })).toBeVisible();

  await page.getByRole('button', { name: 'Letra B' }).click();
  await expect(page.locator('.sheet')).toBeVisible();
  await expect(page.locator('.sheet')).toHaveAttribute('data-letter', 'B');
  await expect.poll(() => countPixels(page, '.layer--ink'), { timeout: 10_000 }).toBeGreaterThan(2000);
});