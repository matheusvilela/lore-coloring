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

test('desfazer volta um traço por vez depois de recarregar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'IndexedDB compartilhado: um worker por vez');
  await page.goto('/');
  await expect.poll(() => countPixels(page, '.layer--ink')).toBeGreaterThan(2000);

  const sheet = page.locator('.sheet');
  const box = (await sheet.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const stroke = async (yOffset: number) => {
    await page.mouse.move(cx - box.width * 0.2, cy + yOffset);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      const t = i / 20;
      await page.mouse.move(cx - box.width * 0.2 + box.width * 0.4 * t, cy + yOffset);
    }
    await page.mouse.up();
  };

  await stroke(-35);
  await stroke(35);
  const both = await paintPixels(page);
  expect(both).toBeGreaterThan(2000);

  await page.waitForTimeout(950);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(50);

  await page.reload();
  await expect.poll(() => paintPixels(page), { timeout: 10_000 }).toBe(both);

  const undo = page.getByRole('button', { name: 'Desfazer' });
  await expect(undo).toBeEnabled();

  await undo.click();
  const afterOne = await paintPixels(page);
  expect(afterOne).toBeGreaterThan(500);
  expect(afterOne).toBeLessThan(both);
  await expect(undo).toBeEnabled();

  await undo.click();
  expect(await paintPixels(page)).toBe(0);
  await expect(undo).toBeDisabled();
});

test('PNG legado sem histórico mantém a pintura e desfazer desligado', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'IndexedDB compartilhado: um worker por vez');
  await page.goto('/');
  await expect.poll(() => countPixels(page, '.layer--ink')).toBeGreaterThan(2000);

  const sheet = page.locator('.sheet');
  const box = (await sheet.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 60, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy, { steps: 12 });
  await page.mouse.up();
  const painted = await paintPixels(page);
  expect(painted).toBeGreaterThan(800);
  await page.waitForTimeout(950);

  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('lore-coloring', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('paint', 'readwrite');
        tx.objectStore('paint').delete('lore:history:A');
        tx.objectStore('paint').delete('lore:base:A');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });

  await page.reload();
  await expect.poll(() => paintPixels(page), { timeout: 10_000 }).toBeGreaterThan(500);
  await expect(page.getByRole('button', { name: 'Desfazer' })).toBeDisabled();
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
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - box.width * 0.2, cy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    await page.mouse.move(cx - box.width * 0.2 + box.width * 0.4 * t, cy + Math.sin(t * Math.PI * 2) * 30);
  }
  await page.mouse.up();
  await expect.poll(() => paintPixels(page)).toBeGreaterThan(800);
  await page.waitForTimeout(900);

  await page.getByRole('button', { name: 'Grade de letras' }).click();
  await expect(page.getByRole('region', { name: 'Grade de letras' })).toBeVisible();

  const wrap = page.locator('.letter-cell-wrap').first();
  await expect(wrap.locator('.letter-cell__paint')).toBeVisible({ timeout: 15_000 });
  const clearA = wrap.getByRole('button', { name: 'Limpar letra A', exact: true });
  await clearA.evaluate((el) => (el as HTMLButtonElement).click());
  await expect(wrap.locator('.letter-cell__paint')).toHaveCount(0);
  await expect(wrap.getByRole('button', { name: 'Limpar letra A', exact: true })).toHaveCount(0);
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