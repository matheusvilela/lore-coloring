import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

async function paintPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.layer--paint');
    if (!canvas) return -1;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
}

function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('exporta só a letra pintada, em PNG na resolução do desenho', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => {
    return page.locator('.layer--ink').evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      if (canvas.width === 0) return 0;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
      return n;
    });
  }, { timeout: 10_000 }).toBeGreaterThan(2000);

  const sheet = page.locator('.sheet');
  const box = (await sheet.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 60, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => paintPixels(page)).toBeGreaterThan(800);

  await page.getByRole('button', { name: 'Grade de letras' }).click();
  await expect(page.getByRole('region', { name: 'Grade de letras' })).toBeVisible();

  const empty = page.locator('.letter-cell-wrap').nth(1);
  await expect(empty.getByRole('button', { name: 'Limpar letra B', exact: true })).toHaveCount(0);
  await expect(empty.getByRole('button', { name: 'Exportar letra B', exact: true })).toHaveCount(0);

  const wrap = page.locator('.letter-cell-wrap').first();
  const trash = wrap.getByRole('button', { name: 'Limpar letra A', exact: true });
  const exp = wrap.getByRole('button', { name: 'Exportar letra A', exact: true });
  await expect(trash).toBeVisible();
  await expect(exp).toBeVisible();

  const trashBox = (await trash.boundingBox())!;
  const expBox = (await exp.boundingBox())!;
  const cellBox = (await wrap.locator('.letter-cell').boundingBox())!;
  expect(expBox.y).toBeGreaterThan(trashBox.y + trashBox.height - 1);
  expect(Math.abs(expBox.x - trashBox.x)).toBeLessThan(2);
  expect(expBox.y + expBox.height).toBeLessThanOrEqual(cellBox.y + cellBox.height + 1);
  expect(expBox.x + expBox.width).toBeLessThanOrEqual(cellBox.x + cellBox.width + 1);

  const backdrop = (el: HTMLElement) => getComputedStyle(el).backdropFilter;
  expect(await trash.evaluate(backdrop)).toBe('blur(22px) saturate(1.35)');
  expect(await exp.evaluate(backdrop)).toBe('blur(22px) saturate(1.35)');
  const header = page.getByRole('button', { name: 'Limpar todas as letras' });
  expect(await header.evaluate(backdrop)).toBe('none');

  const downloadPromise = page.waitForEvent('download');
  await exp.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('lore-A.png');

  const file = await download.path();
  expect(file).toBeTruthy();
  const bytes = await readFile(file!);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(pngSize(bytes)).toEqual({ width: 2048, height: 1562 });

  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let ink = 0;
  let paint = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (r < 40 && g < 40 && b < 40) ink++;
    else if (r > g + 30 && r > b + 30 && r > 80) paint++;
  }
  expect(ink).toBeGreaterThan(500);
  expect(paint).toBeGreaterThan(200);

  await expect(page.getByRole('region', { name: 'Grade de letras' })).toBeVisible();
});
