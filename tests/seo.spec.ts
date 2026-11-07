import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { validSubmission } from './fixtures.ts';

const server = 'http://localhost:3100';
const alphadia = { slug: 'alphadia-i-ii-nintendo-switch-2-edition-5429054', title: 'Alphadia I & II Nintendo Switch 2 Edition', sgdbId: 5429054 };
const summary = `Browser test only ${randomUUID().slice(0, 8)}: reached the title screen`;
let reportId = '';

test.beforeAll(async ({ request }) => {
  const response = await request.post(`${server}/api/reports`, {
    headers: { origin: 'http://lichii.example:3100', 'content-type': 'application/json' },
    data: { ...validSubmission, gameId: alphadia.sgdbId, outcome: 'Playable', summary, log: null, privateLogConsent: false },
  });
  expect(response.status(), await response.text()).toBe(201);
  reportId = (await response.json()).id;
});

async function blockAnalytics(page: Page) {
  await page.route(/^https:\/\/(cdn|basket)\.databuddy\.cc\//, route => route.abort());
}

test.describe('with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });

  test('a game page shows the game heading, status and its reports', async ({ page }) => {
    const response = await page.goto(`/games/${alphadia.slug}`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`${alphadia.title} on Lichii: Playable · Switch 2 compatibility`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(alphadia.title);
    await expect(page.locator('.noscript-status .status')).toHaveText('Playable');
    await expect(page.getByRole('link', { name: summary })).toHaveAttribute('href', `/reports/${reportId}`);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });

  test('an untested game says so instead of looking empty', async ({ page }) => {
    await page.goto('/games/mario-kart-world-5483943');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mario Kart World');
    await expect(page.locator('.noscript-status .status')).toHaveText('Untested');
  });

  test('a report page shows its summary, outcome and setup', async ({ page }) => {
    await page.goto(`/reports/${reportId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(summary);
    await expect(page.locator('.noscript-status .status')).toHaveText('Playable');
    await expect(page.locator('.noscript-status').getByRole('link', { name: alphadia.title })).toHaveAttribute('href', `/games/${alphadia.slug}`);
    await expect(page.getByText(validSubmission.gpu, { exact: true })).toBeVisible();
  });

  test('an unknown game is a real 404', async ({ page }) => {
    const response = await page.goto('/games/no-such-game');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  });
});

test('with JavaScript the app renders as before: no server content flashes and JSON-LD passes the CSP', async ({ page }) => {
  await blockAnalytics(page);
  const violations: string[] = [];
  page.on('console', message => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  let releaseBundle = () => {};
  const bundleHeld = new Promise<void>(resolve => { releaseBundle = resolve; });
  await page.route(/\/assets\/index-[\w-]+\.js$/, async route => { await bundleHeld; await route.continue(); });
  await page.goto(`/games/${alphadia.slug}`, { waitUntil: 'commit' });
  await page.locator('#root').waitFor({ state: 'attached' });
  expect(await page.evaluate(() => document.body.innerText.trim())).toBe('');
  releaseBundle();
  await expect(page.locator('.game-hero h1')).toHaveText(alphadia.title);
  await expect(page.getByText('Latest community result', { exact: true })).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page).toHaveTitle(`${alphadia.title} on Lichii: Playable · Switch 2 compatibility`);
  const structured = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(structured.map(text => JSON.parse(text)['@type'])).toEqual(['VideoGame', 'BreadcrumbList']);
  expect(violations).toEqual([]);
});
