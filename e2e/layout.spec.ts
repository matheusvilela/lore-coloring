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

test('no desktop largo: cores alinham com as ferramentas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const brush = page.getByRole('button', { name: 'Pincel' });
  const crayon = page.getByRole('button', { name: 'Giz de cera' });
  const size = page.getByRole('button', { name: 'Tamanho do traço' });
  const grid = page.getByRole('button', { name: 'Grade de letras' });
  const clear = page.getByRole('button', { name: 'Limpar letra atual' });
  const first = page.getByRole('button', { name: 'Cor vinho' });
  const last = page.getByRole('button', { name: 'Cor branco' });
  const secondRow = page.getByRole('button', { name: 'Cor azul oceano' });

  const brushBox = await brush.boundingBox();
  const crayonBox = await crayon.boundingBox();
  const sizeBox = await size.boundingBox();
  const gridBox = await grid.boundingBox();
  const clearBox = await clear.boundingBox();
  const firstBox = await first.boundingBox();
  const lastBox = await last.boundingBox();
  const secondBox = await secondRow.boundingBox();
  expect(brushBox).not.toBeNull();
  expect(crayonBox).not.toBeNull();
  expect(sizeBox).not.toBeNull();
  expect(gridBox).not.toBeNull();
  expect(clearBox).not.toBeNull();
  expect(firstBox).not.toBeNull();
  expect(lastBox).not.toBeNull();
  expect(secondBox).not.toBeNull();

  expect(firstBox!.x).toBeCloseTo(brushBox!.x, 0);
  expect(firstBox!.x + firstBox!.width).toBeCloseTo(brushBox!.x + brushBox!.width, 0);
  expect(lastBox!.x).toBeCloseTo(clearBox!.x, 0);
  expect(lastBox!.x + lastBox!.width).toBeCloseTo(clearBox!.x + clearBox!.width, 0);
  expect(secondBox!.x).toBeCloseTo(firstBox!.x, 0);
  expect(secondBox!.y).toBeGreaterThan(firstBox!.y + firstBox!.height);

  const buttonGap = crayonBox!.x - (brushBox!.x + brushBox!.width);
  const separatorGap = gridBox!.x - (sizeBox!.x + sizeBox!.width);
  expect(buttonGap).toBeCloseTo(separatorGap, 0);
  expect(separatorGap).toBeGreaterThan(16);
});

test('no celular: a paleta continua em 8 colunas', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');

  const first = page.getByRole('button', { name: 'Cor vinho' });
  const ninth = page.getByRole('button', { name: 'Cor verde folha' });
  const firstBox = await first.boundingBox();
  const ninthBox = await ninth.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(ninthBox).not.toBeNull();
  expect(ninthBox!.x).toBeCloseTo(firstBox!.x, 0);
  expect(ninthBox!.y).toBeGreaterThan(firstBox!.y + firstBox!.height);
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