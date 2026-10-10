import { expect, test, type Page } from '@playwright/test';

async function expectFlightDeckReady(page: Page) {
  await expect(page.locator('.fs-loading-screen')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.fs-ui')).toHaveCount(1);
  await expect(page.locator('[data-intro]')).toHaveCount(1);
  await expect(page.locator('[data-intro]')).toBeVisible();
  await expect(page.locator('.rec-count')).toHaveText('0 pts');
}

async function recordedPoints(page: Page) {
  return Number.parseInt((await page.locator('.rec-count').innerText()), 10);
}

async function expectFlightRunning(page: Page, previousCount = 0) {
  await expect(page.locator('[data-intro]')).toBeHidden();
  await expect(page.locator('[data-message]')).toBeHidden();
  await expect.poll(() => recordedPoints(page)).toBeGreaterThan(previousCount);
  await expect(page.getByRole('button', { name: 'Save Flight to Logbook', exact: true })).toBeEnabled();
}

async function expectFlightPaused(page: Page) {
  await expect(page.locator('[data-intro]')).toBeHidden();
  await expect(page.locator('[data-message]')).toBeVisible();
  await expect(page.locator('[data-message-title]')).toHaveText('Taking a breather?');
  await expect(page.getByRole('button', { name: 'Resume flight', exact: true })).toBeVisible();
  const pausedCount = await recordedPoints(page);
  // Recording runs every 500 ms; a paused flight must skip the next sample.
  await page.waitForTimeout(700);
  expect(await recordedPoints(page)).toBe(pausedCount);
  return pausedCount;
}

for (const startAction of ['Fly approach', 'Start on runway']) {
  test(`${startAction} dismisses the landing page and starts recording`, async ({ page }) => {
    await page.goto('/');
    await expectFlightDeckReady(page);

    await page.getByRole('button', { name: startAction }).click();
    await expectFlightRunning(page);
    const firstCount = await recordedPoints(page);
    await expect.poll(() => recordedPoints(page)).toBeGreaterThan(firstCount);
    await expect(page.locator('.fs-ui')).toHaveCount(1);
  });
}

test('pause and resume buttons dismiss the break overlay and continue recording', async ({ page }) => {
  await page.goto('/');
  await expectFlightDeckReady(page);
  await page.getByRole('button', { name: 'Start on runway' }).click();
  await expectFlightRunning(page);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const pausedCount = await expectFlightPaused(page);
  await page.getByRole('button', { name: 'Resume flight', exact: true }).click();
  await expectFlightRunning(page, pausedCount);
});

test('returning to Flight Deck creates one cockpit and one keyboard pause handler', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expectFlightDeckReady(page);

  // Multiple mounts expose stale global input handlers left behind by a deck.
  for (let visit = 0; visit < 2; visit += 1) {
    await page.getByRole('button', { name: 'Start on runway' }).click();
    await expectFlightRunning(page);
    await page.getByRole('tab', { name: /Flight Logbook/i }).click();
    await expect(page.getByRole('heading', { name: 'Flight Pilot Logbook' })).toBeVisible();
    await expect(page.locator('.fs-ui')).toHaveCount(0);
    await page.getByRole('tab', { name: /Flight Deck/i }).click();
    await expectFlightDeckReady(page);
  }

  await page.getByRole('button', { name: 'Start on runway' }).click();
  await expectFlightRunning(page);
  await page.locator('#scene').focus();
  await page.keyboard.press('p');
  const pausedCount = await expectFlightPaused(page);
  await page.keyboard.press('p');
  await expectFlightRunning(page, pausedCount);
  await expect(page.locator('.fs-ui')).toHaveCount(1);
});
