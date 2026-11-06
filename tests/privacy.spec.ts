import { test, expect, type Page } from '@playwright/test';
import { gunzipSync } from 'node:zlib';
import { gamesResponseSchema } from '../shared/domain.ts';

const scripts = new Map<string, Buffer>();

async function observeDatabuddy(page: Page) {
  const requests: { url: string; body: string }[] = [];
  await page.route('https://cdn.databuddy.cc/**', async route => {
    const url = route.request().url();
    requests.push({ url, body: '' });
    let body = scripts.get(url);
    if (!body) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      body = await response.body();
      scripts.set(url, body);
    }
    await route.fulfill({ body, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://basket.databuddy.cc/**', async route => {
    const buffer = route.request().postDataBuffer();
    const body = buffer?.[0] === 31 && buffer[1] === 139 ? gunzipSync(buffer).toString() : buffer?.toString() ?? '';
    requests.push({ url: route.request().url(), body });
    await route.fulfill({ json: { success: true }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  return requests;
}

async function expectNoReplay(page: Page) {
  await expect(page.locator('script[data-databuddy-replay-injected]')).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(window.databuddyReplay))).toBe(false);
}

async function expectNoTracker(page: Page) {
  await expect(page.locator('script[src*="cdn.databuddy.cc"]')).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(window.databuddy))).toBe(false);
  await expectNoReplay(page);
}

test('public visits load the pinned tracker and Web Vitals automatically without replay', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddy))).toBe(true);
  await expect(page.getByRole('button', { name: 'Tracking preferences' })).toHaveCount(0);
  await expect.poll(async () => {
    await page.evaluate(() => window.databuddy?.flush());
    return requests.some(request => new URL(request.url).pathname === '/vitals');
  }).toBe(true);
  await expectNoReplay(page);
  expect(requests.some(request => /\/replay[./?]/.test(request.url))).toBe(false);
  expect(await page.evaluate(() => window.databuddy?.options)).toMatchObject({ trackWebVitals: true, trackErrors: false, trackAttributes: false, trackInteractions: false, trackOutgoingLinks: false });
  await expect(page.locator('script[data-databuddy-injected]')).toHaveAttribute('integrity', /^sha384-/);
});

test('stored replay consent cannot re-enable session recording', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await page.addInitScript(() => localStorage.setItem('lichii-tracking-consent-v1', 'replay'));
  await page.goto('/privacy');
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddy))).toBe(true);
  await page.mouse.move(100, 100);
  await page.getByRole('link', { name: 'How to report', exact: true }).first().click();
  await expect(page).toHaveURL('/guide');
  await expectNoReplay(page);
  expect(requests.some(request => /\/replay[./?]/.test(request.url))).toBe(false);
});

test('public SPA navigation keeps analytics but private boundaries create clean documents', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddy))).toBe(true);
  await page.evaluate(() => { document.documentElement.dataset.documentMarker = 'public'; });
  await page.getByRole('link', { name: 'How to report', exact: true }).first().click();
  await expect(page).toHaveURL('/guide');
  await expect(page.locator('html')).toHaveAttribute('data-document-marker', 'public');
  await page.getByRole('link', { name: 'Submit a report', exact: true }).first().click();
  await expect(page).toHaveURL('/submit');
  await expect(page.locator('html')).not.toHaveAttribute('data-document-marker', 'public');
  await expectNoTracker(page);
  const privateRequests = requests.length;
  await page.getByRole('link', { name: 'Maintainer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Maintainer access' })).toBeVisible();
  await expectNoTracker(page);
  expect(requests.length).toBe(privateRequests);
  await page.evaluate(() => { document.documentElement.dataset.documentMarker = 'private'; });
  await page.getByRole('link', { name: 'Games', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.locator('html')).not.toHaveAttribute('data-document-marker', 'private');
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddy))).toBe(true);
  await expectNoReplay(page);
});

test('direct sensitive pages and report drafts never load trackers', async ({ page, request }) => {
  const requests = await observeDatabuddy(page);
  const response = gamesResponseSchema.parse(await (await request.get('http://localhost:3100/api/games?q=Mario%20Kart%20World')).json());
  const game = response.games[0];
  if (!game) throw new Error('Missing test catalog game');
  await page.goto(`/submit?game=${game.slug}`);
  await expect(page.getByRole('heading', { name: 'Submit a report', exact: true })).toBeVisible();
  await page.locator('input[name="name"]').fill('PRIVATE_DRAFT_SENTINEL');
  await page.locator('textarea[name="details"]').fill('PRIVATE_REPORT_DETAILS_SENTINEL');
  await expectNoTracker(page);
  await page.goto('/submitted/12345678-1234-1234-1234-123456789abc');
  await expectNoTracker(page);
  await page.goto('/maintainer?error=not-allowed');
  await expectNoTracker(page);
  expect(requests).toEqual([]);
});

test('DNT and GPC keep automatic analytics off', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { get: () => '1', configurable: true }));
  await page.goto('/');
  await expectNoTracker(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'doNotTrack', { get: () => '0', configurable: true });
    Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });
  });
  await page.reload();
  await expectNoTracker(page);
  expect(requests).toEqual([]);
});

test('programmatic SPA boundary crossing never mounts private content in the tracked document', async ({ page }) => {
  await observeDatabuddy(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddy))).toBe(true);
  await page.evaluate(() => {
    document.documentElement.dataset.documentMarker = 'tracked';
    history.pushState(null, '', '/submit');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'What did you play?' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-document-marker', 'tracked');
  await expectNoTracker(page);
});

test('automatic analytics never sends page text, inputs or arbitrary URL queries', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await page.goto('/guide?private=PRIVATE_QUERY_SENTINEL');
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddy))).toBe(true);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.value = 'PRIVATE_INPUT_SENTINEL';
    const text = document.createElement('p');
    text.textContent = 'PRIVATE_TEXT_SENTINEL';
    document.body.append(input, text);
    window.databuddy?.flush();
  });
  await page.mouse.move(150, 150);
  await page.getByRole('link', { name: 'Games', exact: true }).click();
  await expect(page).toHaveURL('/');
  for (const request of requests) expect(request.url + request.body).not.toMatch(/PRIVATE_(QUERY|INPUT|TEXT)_SENTINEL/);
  await expectNoReplay(page);
});

test('desktop reporting tutorial loads its self-hosted screenshots under the CSP without analytics', async ({ page }) => {
  await observeDatabuddy(page);
  const violations: string[] = [];
  page.on('console', message => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await page.goto('/guide');
  await page.getByRole('link', { name: /Reporting from the Lichii desktop app/ }).click();
  await expect(page).toHaveURL('/guide/desktop');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Report from Lichii');
  await expect(page.getByRole('navigation', { name: 'Steps in this guide' }).getByRole('link')).toHaveCount(6);
  const screenshots = page.locator('.tut-shot img');
  await expect(screenshots).toHaveCount(2);
  for (const screenshot of await screenshots.all()) {
    await screenshot.scrollIntoViewIfNeeded();
    await expect.poll(() => screenshot.evaluate(image => image instanceof HTMLImageElement && image.complete ? image.naturalWidth : 0)).toBe(760);
  }
  expect(violations).toEqual([]);
  await expectNoTracker(page);
});
