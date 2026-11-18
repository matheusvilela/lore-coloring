import { expect, test, type Page } from '@playwright/test';

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

async function inkPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.layer--ink');
    if (!canvas || canvas.width === 0) return 0;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
}

/** Um traço horizontal no meio da folha, como uma criança faria. */
async function stroke(page: Page): Promise<void> {
  const box = (await page.locator('.sheet').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - box.width * 0.2, cy);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.2, cy, { steps: 16 });
  await page.mouse.up();
}

async function flushSave(page: Page): Promise<void> {
  await page.waitForTimeout(950);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(50);
}

const langButton = (page: Page, label: string) =>
  page.getByRole('button', { name: `Alfabeto: ${label}. Trocar alfabeto` });

test('troca de alfabeto, pinta o ㄱ e volta com o latim intacto', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'IndexedDB compartilhado: um worker por vez');

  await page.goto('/');
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(2000);

  // pinta o A antes de trocar: a pintura tem que sobreviver à troca de idioma
  await stroke(page);
  await expect.poll(() => paintPixels(page)).toBeGreaterThan(800);

  await page.getByRole('button', { name: 'Grade de letras' }).click();
  await expect(page.getByRole('region', { name: 'Grade de letras' })).toBeVisible();
  await expect(page.locator('.letter-cell')).toHaveCount(26);

  const pt = langButton(page, 'Português');
  await expect(pt).toBeVisible();
  await expect(pt).toHaveAttribute('aria-expanded', 'false');
  await pt.click();

  const menu = page.getByRole('menu', { name: 'Escolher alfabeto' });
  await expect(menu).toBeVisible();
  const options = menu.getByRole('menuitemradio');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAccessibleName('Português');
  await expect(options.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(options.nth(1)).toHaveAccessibleName('Coreano');
  await expect(options.nth(1)).toHaveAttribute('aria-checked', 'false');

  await options.nth(1).click();
  await expect(menu).toHaveCount(0);
  await expect(langButton(page, 'Coreano')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.letter-cell')).toHaveCount(40);
  await expect(page.getByRole('button', { name: 'Letra ㄱ', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Letra ㄱ', exact: true }).click();
  await expect(page.locator('.sheet')).toHaveAttribute('data-letter', 'giyeok');
  const status = page.locator('.letter-status');
  await expect(status).toHaveText('ㄱ');
  await expect(status).toHaveAttribute('lang', 'ko');

  await expect.poll(() => inkPixels(page)).toBeGreaterThan(2000);
  await stroke(page);
  await expect.poll(() => paintPixels(page)).toBeGreaterThan(800);
  await flushSave(page);

  // recarregar mantém o alfabeto escolhido, a letra e a pintura do jamo
  await page.reload();
  await expect(page.locator('.sheet')).toHaveAttribute('data-letter', 'giyeok');
  await expect(status).toHaveText('ㄱ');
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(2000);
  await expect.poll(() => paintPixels(page), { timeout: 10_000 }).toBeGreaterThan(500);

  // voltar para o português: 26 letras e o A continua pintado
  await page.getByRole('button', { name: 'Grade de letras' }).click();
  await page.getByRole('button', { name: 'Alfabeto: Coreano. Trocar alfabeto' }).click();
  await page.getByRole('menuitemradio', { name: 'Português' }).click();
  await expect(page.locator('.letter-cell')).toHaveCount(26);
  // a miniatura sai do PNG salvo: prova que o A ficou no armazenamento
  await expect(page.locator('.letter-cell-wrap').first().locator('.letter-cell__paint')).toHaveCount(
    1,
  );

  await page.getByRole('button', { name: 'Letra A', exact: true }).click();
  await expect(page.locator('.sheet')).toHaveAttribute('data-letter', 'A');
  await expect(status).toHaveText('A');
  expect(await status.getAttribute('lang')).toBeNull();
  await expect.poll(() => paintPixels(page), { timeout: 10_000 }).toBeGreaterThan(500);
});

test('no celular: bandeira ao lado da lixeira e menu ancorado no botão', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'celular', 'mede o layout de celular uma vez só');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Grade de letras' }).click();
  await expect(page.getByRole('region', { name: 'Grade de letras' })).toBeVisible();

  const flag = langButton(page, 'Português');
  const clearAll = page.getByRole('button', { name: 'Limpar todas as letras' });
  const back = page.getByRole('button', { name: 'Voltar ao desenho' });

  const [flagBox, clearBox, backBox] = await Promise.all([
    flag.boundingBox(),
    clearAll.boundingBox(),
    back.boundingBox(),
  ]);
  expect(flagBox).not.toBeNull();
  expect(clearBox).not.toBeNull();
  expect(backBox).not.toBeNull();
  // mesma linha do voltar, à direita, imediatamente à esquerda da lixeira
  expect(Math.abs(flagBox!.y - backBox!.y)).toBeLessThan(1);
  expect(flagBox!.x).toBeGreaterThan(backBox!.x + backBox!.width);
  expect(flagBox!.x + flagBox!.width).toBeLessThan(clearBox!.x + 1);
  expect(Math.abs(flagBox!.y - clearBox!.y)).toBeLessThan(1);

  await flag.click();
  const menu = page.getByRole('menu', { name: 'Escolher alfabeto' });
  await expect(menu).toBeVisible();
  const menuBox = (await menu.boundingBox())!;
  // encostado no botão: abaixo dele e alinhado pela direita
  expect(menuBox.y).toBeGreaterThanOrEqual(flagBox!.y + flagBox!.height);
  expect(menuBox.y - (flagBox!.y + flagBox!.height)).toBeLessThan(20);
  expect(Math.abs(menuBox.x + menuBox.width - (flagBox!.x + flagBox!.width))).toBeLessThan(2);
  expect(menuBox.x).toBeGreaterThanOrEqual(12);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390 - 12 + 1);

  // a bandeira atual é a do Brasil; trocar fecha o menu e troca a grade
  await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
  await menu.getByRole('menuitemradio', { name: 'Coreano' }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.letter-cell')).toHaveCount(40);
  await expect(langButton(page, 'Coreano')).toBeVisible();
});
