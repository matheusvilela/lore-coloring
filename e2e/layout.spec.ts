import { expect, test } from '@playwright/test';

test('dock em duas linhas no Pixel 9 Pro XL', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');

  const flexBasis = await page.locator('.tools').evaluate((el) => getComputedStyle(el).flexBasis);
  expect(flexBasis).toBe('100%');
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