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

test('no celular: ações ficam acima das ferramentas de pintura', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');

  const undo = page.getByRole('button', { name: 'Desfazer' });
  const brush = page.getByRole('button', { name: 'Pincel' });
  const undoBox = await undo.boundingBox();
  const brushBox = await brush.boundingBox();
  expect(undoBox).not.toBeNull();
  expect(brushBox).not.toBeNull();
  expect(undoBox!.y + undoBox!.height).toBeLessThanOrEqual(brushBox!.y + 4);
});

test('no celular: separador horizontal entre as linhas; botões do mesmo tamanho', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');

  await expect(page.locator('.dock__controls')).toHaveClass(/is-stacked/);
  await expect(page.locator('.dock__block--paint.dock__block--row-sep')).toBeVisible();
  await expect(page.locator('.dock__sep--v')).toBeHidden();

  const undo = page.getByRole('button', { name: 'Desfazer' });
  const brush = page.getByRole('button', { name: 'Pincel' });
  const undoBox = await undo.boundingBox();
  const brushBox = await brush.boundingBox();
  expect(undoBox!.width).toBeCloseTo(brushBox!.width, 0);
  expect(undoBox!.height).toBeCloseTo(brushBox!.height, 0);
});

test('no desktop largo: pintura à esquerda das ações numa faixa com divisor vertical', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const undo = page.getByRole('button', { name: 'Desfazer' });
  const brush = page.getByRole('button', { name: 'Pincel' });
  const sep = page.locator('.dock__sep--v');

  const undoBox = await undo.boundingBox();
  const brushBox = await brush.boundingBox();
  expect(undoBox).not.toBeNull();
  expect(brushBox).not.toBeNull();
  expect(brushBox!.x).toBeLessThan(undoBox!.x);
  const dy = Math.abs((undoBox?.y ?? 0) - (brushBox?.y ?? 0));
  expect(dy).toBeLessThanOrEqual(8);
  await expect(sep).toBeVisible();
  await expect(page.locator('.dock__controls')).toHaveClass(/is-inline/);
});

test('no desktop estreito: pintura na linha de cima e separador horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto('/');

  await expect(page.locator('.dock__controls')).toHaveClass(/is-stacked/);

  const undo = page.getByRole('button', { name: 'Desfazer' });
  const brush = page.getByRole('button', { name: 'Pincel' });
  const undoBox = await undo.boundingBox();
  const brushBox = await brush.boundingBox();
  expect(brushBox!.y + brushBox!.height).toBeLessThanOrEqual(undoBox!.y + 4);
  await expect(page.locator('.dock__block--actions.dock__block--row-sep')).toBeVisible();
  await expect(page.locator('.dock__sep--v')).toBeHidden();
});

test('no desktop baixo: controles numa fita horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto('/');

  const controls = page.locator('.dock__controls');
  await expect(controls).toBeVisible();
  const styles = await controls.evaluate((el) => {
    const s = getComputedStyle(el);
    return { wrap: s.flexWrap, overflowX: s.overflowX };
  });
  expect(styles.wrap).toBe('nowrap');
  expect(styles.overflowX).toBe('auto');
});