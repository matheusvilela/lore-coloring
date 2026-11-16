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