import { test, expect, type Page } from '@playwright/test';
import { gunzipSync } from 'node:zlib';
import { CONSENT_KEY, type TrackingConsent } from '../src/tracking-policy.ts';
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
  return requests;
}

async function setConsent(page: Page, consent: TrackingConsent) {
  await page.addInitScript(({ key, consent }) => {
    localStorage.setItem(key, consent);
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  }, { key: CONSENT_KEY, consent });
}

async function expectNoTracker(page: Page) {
  await expect(page.locator('script[src*="cdn.databuddy.cc"]')).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(window.databuddy || window.databuddyReplay))).toBe(false);
}

test('no tracking before consent, after rejection, with invalid consent or unavailable storage', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reject optional tracking' })).toBeVisible();
  await expectNoTracker(page);
  await page.getByRole('button', { name: 'Reject optional tracking' }).click();
  await page.waitForLoadState();
  await expectNoTracker(page);
  await page.evaluate(key => localStorage.setItem(key, 'invalid-consent'), CONSENT_KEY);
  await page.reload();
  await expectNoTracker(page);
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'getItem', { value: () => { throw new Error('Storage unavailable'); } });
    Object.defineProperty(Storage.prototype, 'setItem', { value: () => { throw new Error('Storage unavailable'); } });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Allow analytics and replay' }).click();
  await expect(page.getByRole('alert')).toContainText('could not save');
  await expectNoTracker(page);
  expect(requests).toEqual([]);
});

test('analytics-only consent loads the real pinned tracker and Web Vitals but not replay', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await setConsent(page, 'analytics');
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddy))).toBe(true);
  await expect.poll(async () => {
    await page.evaluate(() => window.databuddy?.flush());
    return requests.some(request => new URL(request.url).pathname === '/vitals');
  }).toBe(true);
  await expect(page.locator('script[data-databuddy-replay-injected]')).toHaveCount(0);
  expect(requests.some(request => /\/replay[./]/.test(request.url))).toBe(false);
  const options = await page.evaluate(() => window.databuddy?.options);
  expect(options).toMatchObject({ trackWebVitals: true, trackErrors: false, trackAttributes: false, trackInteractions: false, trackOutgoingLinks: false });
  await expect(page.locator('script[data-databuddy-injected]')).toHaveAttribute('integrity', /^sha384-/);
});

test('public SPA navigation preserves replay but private boundaries create clean documents', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await setConsent(page, 'replay');
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddyReplay))).toBe(true);
  await page.mouse.move(100, 100);
  await expect(page.locator('script[data-databuddy-replay-injected]')).toHaveAttribute('data-databuddy-replay-state', /recording|buffering/);
  await page.evaluate(() => { document.documentElement.dataset.documentMarker = 'public'; });
  await page.getByRole('link', { name: 'How to report', exact: true }).first().click();
  await expect(page).toHaveURL('/guide');
  await expect(page.locator('html')).toHaveAttribute('data-document-marker', 'public');
  await page.getByRole('link', { name: 'Submit a report', exact: true }).first().click();
  await expect(page).toHaveURL('/submit');
  await expect(page.locator('html')).not.toHaveAttribute('data-document-marker', 'public');
  await expect(page.locator('main')).toHaveAttribute('data-replay-block', '');
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
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddyReplay))).toBe(true);
});

test('direct sensitive pages and report drafts never load trackers, even with replay consent', async ({ page, request }) => {
  const requests = await observeDatabuddy(page);
  await setConsent(page, 'replay');
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

test('DNT and GPC override stored replay consent', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await setConsent(page, 'replay');
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
  await setConsent(page, 'replay');
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddyReplay))).toBe(true);
  await page.evaluate(() => {
    document.documentElement.dataset.documentMarker = 'tracked';
    history.pushState(null, '', '/submit');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'What did you play?' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-document-marker', 'tracked');
  await expectNoTracker(page);
});

test('cross-tab consent withdrawal reloads an existing tracked page', async ({ page, context }) => {
  await observeDatabuddy(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Allow analytics and replay' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddyReplay))).toBe(true);
  const otherTab = await context.newPage();
  await observeDatabuddy(otherTab);
  await otherTab.goto('/privacy');
  await Promise.all([
    page.waitForEvent('load'),
    otherTab.evaluate(key => localStorage.setItem(key, 'off'), CONSENT_KEY),
  ]);
  await expectNoTracker(page);
});

test('the real recorder masks text and inputs, blocks sensitive sections and strips URL queries', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await setConsent(page, 'replay');
  await page.goto('/guide?private=PRIVATE_QUERY_SENTINEL');
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddyReplay))).toBe(true);
  await page.evaluate(() => {
    const block = document.createElement('section');
    block.setAttribute('data-replay-block', '');
    block.textContent = 'PRIVATE_BLOCK_SENTINEL';
    const input = document.createElement('input');
    input.value = 'PRIVATE_INPUT_SENTINEL';
    const text = document.createElement('p');
    text.textContent = 'PRIVATE_TEXT_SENTINEL';
    document.body.append(block, input, text);
  });
  await page.mouse.move(150, 150);
  await expect.poll(() => requests.some(request => request.url.startsWith('https://basket.databuddy.cc/replay?') && request.body.includes('"type":2'))).toBe(true);
  for (const request of requests) {
    expect(request.url + request.body).not.toMatch(/PRIVATE_(QUERY|BLOCK|INPUT|TEXT)_SENTINEL/);
  }
});

test('an in-flight recorder script cannot follow a visitor into a private document', async ({ page }) => {
  await observeDatabuddy(page);
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://cdn.databuddy.cc/replay.*.js', async route => {
    const response = await route.fetch();
    await released;
    await route.fulfill({ response }).catch(() => {});
  });
  await setConsent(page, 'replay');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('script[data-databuddy-replay-injected]')).toHaveCount(1);
  await page.getByRole('link', { name: 'Submit a report', exact: true }).first().click();
  await expect(page).toHaveURL('/submit');
  release();
  await expect(page.getByRole('heading', { name: 'What did you play?' })).toBeVisible();
  await expectNoTracker(page);
});

test('revoking consent stops recording and reloads without tracking', async ({ page }) => {
  const requests = await observeDatabuddy(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Allow analytics and replay' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.databuddyReplay))).toBe(true);
  await page.getByRole('button', { name: 'Tracking preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Reject optional tracking' }).click();
  await page.waitForLoadState();
  await expectNoTracker(page);
  const afterRevoke = requests.length;
  await page.getByRole('link', { name: 'How to report', exact: true }).first().click();
  await expect(page).toHaveURL('/guide');
  await expectNoTracker(page);
  expect(requests.length).toBe(afterRevoke);
});
