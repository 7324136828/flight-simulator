import { expect, test } from '@playwright/test';

const backendUrl = 'http://127.0.0.1:8001';

test('serves the frontend through the live FastAPI backend', async ({ page }) => {
  const healthResponse = await page.request.get('/api/health');
  expect(healthResponse.ok()).toBeTruthy();
  const healthData = await healthResponse.json();
  expect(healthData.status).toBe('ok');

  await page.goto('/');
  await expect(page.locator('.brand-title')).toHaveText('FLIGHT SIMULATOR');
  await expect(page.locator('#scene')).toBeVisible();
});

test('navigates seamlessly between Flight Deck, Logbook, and Data Hub', async ({ page }) => {
  await page.goto('/');

  // 1. Verify Flight Deck is default active tab
  await expect(page.locator('#scene')).toBeVisible();

  // 2. Navigate to Flight Logbook
  await page.getByRole('tab', { name: /Flight Logbook/i }).click();
  await expect(page.getByRole('heading', { name: 'Flight Pilot Logbook' })).toBeVisible();
  await expect(page.locator('.stats-grid')).toBeVisible();

  // 3. Navigate to Data Hub & Converter
  await page.getByRole('tab', { name: /Data Hub & Converter/i }).click();
  await expect(page.getByRole('heading', { name: 'Document & Flight Data Ingestion Hub' })).toBeVisible();
  await expect(page.locator('.dropzone')).toBeVisible();
  await expect(page.locator('.history-screen')).toBeVisible();

  // 4. Return to Flight Deck
  await page.getByRole('tab', { name: /Flight Deck/i }).click();
  await expect(page.locator('#scene')).toBeVisible();
});

test('records flight telemetry and displays in logbook', async ({ page, request }) => {
  // Save a simulated flight via API
  const flightPayload = {
    map_id: 'chicago',
    map_label: 'Chicago · Meigs Field',
    runway_id: 'scenery-chicago-bgl-18197',
    runway_heading: 360.0,
    duration_seconds: 45.2,
    max_speed_knots: 72.0,
    max_altitude_feet: 850.0,
    landing_status: 'landed',
    touchdown_vertical_speed_fpm: -110.0,
    centerline_offset_feet: 2.1,
    rating_stars: 5,
    telemetry: [
      {
        time: 0,
        x: 0,
        y: 10,
        z: -500,
        pitch: 0,
        roll: 0,
        heading: 360,
        airspeed_knots: 65,
        altitude_feet: 150,
        vertical_speed_fpm: -400,
        throttle: 0.3,
        gear: true,
        flaps: true,
      },
    ],
  };

  const createRes = await request.post(`${backendUrl}/api/flights`, {
    data: flightPayload,
  });
  expect(createRes.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('tab', { name: /Flight Logbook/i }).click();

  // Verify flight record is rendered in table
  await expect(page.locator('.logbook-table')).toContainText('Chicago · Meigs Field');
  await expect(page.locator('.logbook-table')).toContainText('LANDED');
});

