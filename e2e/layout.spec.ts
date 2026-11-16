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

test('no celular: o divisor some na coluna', async ({ page }) => {
  await page.setViewportSize({ width: 448, height: 997 });
  await page.goto('/');
  await expect(page.locator('.dock__sep')).toBeHidden();
});

test('no desktop largo: ações e pintura compartilham uma faixa com divisor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const undo = page.getByRole('button', { name: 'Desfazer' });
  const brush = page.getByRole('button', { name: 'Pincel' });
  const sep = page.locator('.dock__sep');

  const undoBox = await undo.boundingBox();
  const brushBox = await brush.boundingBox();
  expect(undoBox).not.toBeNull();
  expect(brushBox).not.toBeNull();
  const dy = Math.abs((undoBox?.y ?? 0) - (brushBox?.y ?? 0));
  expect(dy).toBeLessThanOrEqual(8);
  await expect(sep).toBeVisible();
});

/** Centro horizontal do bloco vs centro da faixa (tolerância em px). */
async function expectGroupCentered(
  page: import('@playwright/test').Page,
  groupSelector: string,
  stripSelector: string,
  tolerance = 28,
) {
  const group = page.locator(groupSelector).first();
  const strip = page.locator(stripSelector).first();
  await expect(group).toBeVisible();
  await expect(strip).toBeVisible();
  const boxes = await page.evaluate(
    ({ groupSel, stripSel }) => {
      const groupEl = document.querySelector(groupSel)!;
      const stripEl = document.querySelector(stripSel)!;
      const g = groupEl.getBoundingClientRect();
      const s = stripEl.getBoundingClientRect();
      return { groupMid: g.left + g.width / 2, stripMid: s.left + s.width / 2 };
    },
    { groupSel: groupSelector, stripSel: stripSelector },
  );
  expect(Math.abs(boxes.groupMid - boxes.stripMid)).toBeLessThanOrEqual(tolerance);
}

test('em resoluções estreitas as duas faixas do dock ficam centralizadas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expectGroupCentered(page, '.dock__block--actions', '.dock__tools');
  await expectGroupCentered(page, '.dock__block--paint', '.dock__tools');
  await expectGroupCentered(page, '.palette', '.dock__colors');
});

test('em desktop baixo as faixas do dock ficam centralizadas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto('/');

  await expectGroupCentered(page, '.dock__controls', '.dock__tools', 48);
  await expectGroupCentered(page, '.palette', '.dock__colors', 48);
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