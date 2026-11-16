import { expect, test } from '@playwright/test';

test('no celular: ferramentas em cima, folha no meio, cores embaixo', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');

  const tools = page.locator('.dock__tools');
  const sheet = page.locator('.sheet');
  const palette = page.locator('.palette');

  const toolsBox = await tools.boundingBox();
  const sheetBox = await sheet.boundingBox();
  const paletteBox = await palette.boundingBox();

  expect(toolsBox).not.toBeNull();
  expect(sheetBox).not.toBeNull();
  expect(paletteBox).not.toBeNull();

  expect(toolsBox!.y + toolsBox!.height).toBeLessThanOrEqual(sheetBox!.y + 4);
  expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(paletteBox!.y + 4);
});

test('undo fica na mesma faixa que os tamanhos no celular largo', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');

  const undo = page.getByRole('button', { name: 'Desfazer' });
  const sizes = page.locator('.sizes');
  const undoBox = await undo.boundingBox();
  const sizesBox = await sizes.boundingBox();
  expect(undoBox).not.toBeNull();
  expect(sizesBox).not.toBeNull();
  const dy = Math.abs((undoBox?.y ?? 0) - (sizesBox?.y ?? 0));
  expect(dy).toBeLessThanOrEqual(8);
});