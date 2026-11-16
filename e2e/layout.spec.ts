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

test('no celular: colunas alinham entre as duas linhas', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');

  const grid = page.getByRole('button', { name: 'Grade de letras' });
  const brush = page.getByRole('button', { name: 'Pincel' });
  const move = page.getByRole('button', { name: 'Mover' });
  const sizeBtn = page.getByRole('button', { name: 'Tamanho do traço' });
  const zoomOut = page.getByRole('button', { name: 'Zoom menos' });
  const clear = page.getByRole('button', { name: 'Limpar letra atual' });

  const gridBox = await grid.boundingBox();
  const brushBox = await brush.boundingBox();
  const moveBox = await move.boundingBox();
  const sizeBox = await sizeBtn.boundingBox();
  const zoomOutBox = await zoomOut.boundingBox();
  const clearBox = await clear.boundingBox();
  expect(gridBox).not.toBeNull();
  expect(brushBox).not.toBeNull();
  expect(moveBox).not.toBeNull();
  expect(sizeBox).not.toBeNull();
  expect(zoomOutBox).not.toBeNull();
  expect(clearBox).not.toBeNull();
  expect(gridBox!.x).toBeCloseTo(brushBox!.x, 0);
  expect(moveBox!.x).toBeCloseTo(zoomOutBox!.x, 0);
  expect(sizeBox!.x + sizeBox!.width).toBeCloseTo(clearBox!.x + clearBox!.width, 0);
});

test('no celular: botões de ação e pintura do mesmo tamanho', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');

  await expect(page.locator('.dock__sep--v')).toBeHidden();

  const undo = page.getByRole('button', { name: 'Desfazer' });
  const brush = page.getByRole('button', { name: 'Pincel' });
  const undoBox = await undo.boundingBox();
  const brushBox = await brush.boundingBox();
  expect(undoBox!.width).toBeCloseTo(brushBox!.width, 0);
  expect(undoBox!.height).toBeCloseTo(brushBox!.height, 0);
});

test('no celular: o divisor some na coluna', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');
  await expect(page.locator('.dock__sep--v')).toBeHidden();
});

test('no desktop largo: pintura à esquerda das ações com divisor no meio', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const undo = page.getByRole('button', { name: 'Desfazer' });
  const bucket = page.getByRole('button', { name: 'Balde de tinta' });
  const sep = page.locator('.dock__sep--v');

  const undoBox = await undo.boundingBox();
  const bucketBox = await bucket.boundingBox();
  const sepBox = await sep.boundingBox();
  expect(undoBox).not.toBeNull();
  expect(bucketBox).not.toBeNull();
  expect(sepBox).not.toBeNull();

  expect(bucketBox!.x).toBeLessThan(sepBox!.x);
  expect(sepBox!.x).toBeLessThan(undoBox!.x);
  const dy = Math.abs((undoBox?.y ?? 0) - (bucketBox?.y ?? 0));
  expect(dy).toBeLessThanOrEqual(8);
  await expect(sep).toBeVisible();
});

test('no desktop estreito: pintura na linha de cima sem divisor vertical', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto('/');

  const undo = page.getByRole('button', { name: 'Desfazer' });
  const brush = page.getByRole('button', { name: 'Pincel' });
  const undoBox = await undo.boundingBox();
  const brushBox = await brush.boundingBox();
  expect(brushBox!.y + brushBox!.height).toBeLessThanOrEqual(undoBox!.y + 4);
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

test('menu de tamanho: visível, alinhado à direita, linha na base da cunha', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');

  const button = page.getByRole('button', { name: 'Tamanho do traço' });
  await button.click();
  const popover = page.getByRole('dialog', { name: 'Espessura do traço' });
  await expect(popover).toBeVisible();

  const buttonBox = await button.boundingBox();
  const popoverBox = await popover.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(popoverBox).not.toBeNull();
  expect(popoverBox!.y).toBeGreaterThan(buttonBox!.y + buttonBox!.height - 2);
  expect(popoverBox!.x + popoverBox!.width).toBeCloseTo(buttonBox!.x + buttonBox!.width, 0);
  expect(popoverBox!.y + popoverBox!.height).toBeLessThan(997);

  const baselineGap = await page.evaluate(() => {
    const thumb = document.querySelector('.size-popover__thumb')!;
    const track = document.querySelector('.size-popover__track')!;
    return thumb.getBoundingClientRect().bottom - track.getBoundingClientRect().bottom;
  });
  expect(baselineGap).toBeCloseTo(2, 0);

  await page.setViewportSize({ width: 1280, height: 900 });
  const desktopButton = await button.boundingBox();
  const desktopPopover = await popover.boundingBox();
  expect(desktopPopover!.y + desktopPopover!.height).toBeLessThan(desktopButton!.y + 4);
  expect(desktopPopover!.x + desktopPopover!.width).toBeCloseTo(desktopButton!.x + desktopButton!.width, 0);
});