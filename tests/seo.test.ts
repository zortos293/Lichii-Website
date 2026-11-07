import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { createApp } from '../server/app.ts';
import { readConfig } from '../server/config.ts';
import { prepareDatabase } from '../server/db.ts';
import { validSubmission } from './fixtures.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/lichii_test') throw new Error('Use an isolated lichii_test database.');
if (!existsSync(new URL('../dist/index.html', import.meta.url))) throw new Error('Run npm run build first: these tests render the built index.html.');
const sql = postgres(databaseUrl, { connection: { search_path: 'seo_pages' }, onnotice: () => {} });
const origin = 'https://lichii.example';
const config = readConfig({ DATABASE_URL: databaseUrl, APP_ORIGIN: origin, COOKIE_SECRET: 'seo-test-cookie-secret'.repeat(3), RATE_LIMIT_SECRET: 'seo-test-rate-secret'.repeat(3), NODE_ENV: 'test' });
const app = await createApp(config, sql, true, async () => {});
const catalog: { slug: string; title: string }[] = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const desktopApi = await readFile(new URL('../docs/desktop-api.md', import.meta.url), 'utf8');

const mario = 'mario-kart-world-5483943';
const alphadia = 'alphadia-i-ii-nintendo-switch-2-edition-5429054';
const visible = '0b7d2f1e-3c4a-4b5d-8e6f-7a8b9c0d1e2f';
const hidden = '1c8e3a2f-4d5b-4c6e-9f7a-8b9c0d1e2f3a';
const hostile = `Boots </script><script>alert(1)</script> "fine" & 'ok'`;
const { publicConsent: _p, safeFilesConsent: _s, privateLogConsent: _l, log: _log, website: _w, ...fields } = validSubmission;

before(async () => {
  await sql`DROP SCHEMA IF EXISTS seo_pages CASCADE`;
  await sql`CREATE SCHEMA seo_pages`;
  await prepareDatabase(sql);
  await sql`INSERT INTO reports(id, game_id, fields, created_at) VALUES (${visible}, 5429054, ${sql.json({ ...fields, gameId: 5429054, summary: hostile, outcome: 'Playable', build: 'build-93' })}, '2026-11-01T10:00:00Z')`;
  await sql`INSERT INTO reports(id, game_id, fields, triage) VALUES (${hidden}, 5483943, ${sql.json({ ...fields, summary: 'HIDDEN_REPORT_SENTINEL' })}, 'hidden')`;
  await app.ready();
});
after(async () => {
  await app.close();
  await sql`DROP SCHEMA seo_pages CASCADE`;
  await sql.end();
});

const get = (url: string) => app.inject({ url });
const one = (body: string, pattern: RegExp) => {
  const matches = [...body.matchAll(new RegExp(pattern, 'g'))];
  assert.equal(matches.length, 1, `expected one match for ${pattern}`);
  return matches[0]?.[1];
};
const titleOf = (body: string) => one(body, /<title>([^<]*)<\/title>/);
const canonicalOf = (body: string) => /<link rel="canonical" href="([^"]*)"/.exec(body)?.[1];
const robotsOf = (body: string) => one(body, /<meta name="robots" content="([^"]*)"/);
const structuredData = (body: string) => [...body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(match => JSON.parse(match[1] ?? 'null') as Record<string, unknown>);
const noscriptOf = (body: string) => /<noscript>(.*)<\/noscript><div id="root"><\/div>/s.exec(body)?.[1] ?? '';

test('every public route gets its own title, description, canonical URL and index robots meta', async () => {
  const routes = [
    ['/', `Lichii Switch 2 compatibility: community reports for ${catalog.length} games`, '/'],
    ['/?q=mario&page=2', `Lichii Switch 2 compatibility: community reports for ${catalog.length} games`, '/'],
    [`/games/${mario}`, 'Mario Kart World on Lichii: untested · Switch 2 compatibility', `/games/${mario}`],
    [`/games/${alphadia}`, 'Alphadia I &amp; II Nintendo Switch 2 Edition on Lichii: Playable · Switch 2 compatibility', `/games/${alphadia}`],
    [`/reports/${visible}`, 'Boots &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &quot;fine&quot; &amp; &#39;ok&#39; · Alphadia I &amp; II Nintendo Switch 2 Edition (Playable) · Lichii', `/reports/${visible}`],
    ['/reports?platform=windows', 'Recent Switch 2 compatibility reports · Lichii', '/reports'],
    ['/guide', 'How to report a Switch 2 game on Lichii', '/guide'],
    ['/guide/desktop', 'Report from the Lichii desktop app in six steps · Lichii', '/guide/desktop'],
    ['/privacy', 'Privacy &amp; safety · Lichii compatibility', '/privacy'],
  ];
  for (const [url = '', title, path] of routes) {
    const response = await get(url);
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8', url);
    assert.equal(response.headers['cache-control'], 'no-cache', url);
    assert.equal(response.headers['x-robots-tag'], undefined, url);
    assert.equal(titleOf(response.body), title, url);
    assert.equal(canonicalOf(response.body), origin + path, url);
    assert.equal(robotsOf(response.body), 'index, follow', url);
    assert.ok(one(response.body, /<meta name="description" content="([^"]+)"/), url);
    assert.equal(one(response.body, /<meta property="og:url" content="([^"]*)"/), origin + path, url);
    assert.match(one(response.body, /<meta property="og:image" content="([^"]*)"/) ?? '', /^https:\/\/lichii\.example\/(art|branding)\//, url);
  }
  const game = await get(`/games/${alphadia}`);
  assert.match(one(game.body, /<meta name="description" content="([^"]*)"/) ?? '', /Latest community result for Alphadia I &amp; II Nintendo Switch 2 Edition on the Lichii Switch 2 emulator: Playable\. 1 public report/);
});

test('private pages are noindex and unknown games, reports and routes return a real 404', async () => {
  for (const url of ['/submit?game=' + mario, `/submitted/${visible}`, '/maintainer?error=not-allowed']) {
    const response = await get(url);
    assert.equal(response.statusCode, 200, url);
    assert.equal(robotsOf(response.body), 'noindex', url);
    assert.equal(response.headers['x-robots-tag'], 'noindex', url);
    assert.equal(canonicalOf(response.body), undefined, url);
  }
  for (const url of ['/games/no-such-game', '/games/Mario-Kart-World-5483943', `/reports/${hidden}`, '/reports/2d9f4b3a-5e6c-4d7f-8a9b-0c1d2e3f4a5b', '/reports/not-a-uuid', '/no-such-page', '/guide/missing']) {
    const response = await get(url);
    assert.equal(response.statusCode, 404, url);
    assert.equal(titleOf(response.body), 'Page not found · Lichii', url);
    assert.equal(robotsOf(response.body), 'noindex', url);
    assert.equal(response.headers['x-robots-tag'], 'noindex', url);
    assert.match(response.body, /<div id="root"><\/div><\/body>/, url);
    assert.equal(response.body.includes('HIDDEN_REPORT_SENTINEL'), false, url);
  }
  for (const url of ['/games/no-such-game.md', '/missing.txt', '/api/no-such-route']) {
    const response = await get(url);
    assert.equal(response.statusCode, 404, url);
    assert.deepEqual(response.json(), { error: 'Not found.' }, url);
  }
  assert.equal((await get('/api/games/no-such-game')).headers['x-robots-tag'], 'noindex');
});

test('duplicate URLs redirect permanently to one canonical path', async () => {
  const redirects = [
    ['/guide/', '/guide'],
    [`/games/${mario}/?ref=feed`, `/games/${mario}?ref=feed`],
    [`/games/mario%2Dkart-world-5483943`, `/games/${mario}`],
    [`/reports/${visible.toUpperCase()}`, `/reports/${visible}`],
    ['/index.html', '/'],
  ];
  for (const [url = '', location] of redirects) {
    const response = await get(url);
    assert.equal(response.statusCode, 301, url);
    assert.equal(response.headers.location, location, url);
  }
  for (const url of ['//evil.example/', '/%2F%2Fevil.example/', '/\\evil.example/']) assert.equal((await get(url)).headers.location, undefined, url);
});

test('user text is escaped in the head, the no-JS body and JSON-LD', async () => {
  const { body } = await get(`/reports/${visible}`);
  assert.equal(body.includes('<script>alert(1)'), false);
  assert.equal(body.includes(hostile), false);
  assert.equal([...body.matchAll(/<script\b/g)].length, 2);
  assert.ok(noscriptOf(body).includes('<h1 class="page-title">Boots &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &quot;fine&quot; &amp; &#39;ok&#39;</h1>'));
  const game = await get(`/games/${alphadia}`);
  assert.equal(game.body.includes('<script>alert(1)'), false);
  for (const block of game.body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) assert.doesNotMatch(block[1] ?? '', /[<>&]/);
  assert.equal(structuredData(game.body)[0]?.name, 'Alphadia I & II Nintendo Switch 2 Edition');
});

test('structured data is honest: WebSite search, VideoGame without ratings and breadcrumbs', async () => {
  const [website] = structuredData((await get('/')).body);
  assert.deepEqual(website?.potentialAction, { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/?q={search_term_string}` }, 'query-input': 'required name=search_term_string' });
  assert.equal(website?.['@type'], 'WebSite');
  assert.equal(website?.url, `${origin}/`);

  const [game, crumbs, ...rest] = structuredData((await get(`/games/${mario}`)).body);
  assert.equal(rest.length, 0);
  assert.deepEqual(game, {
    '@context': 'https://schema.org', '@type': 'VideoGame', name: 'Mario Kart World', url: `${origin}/games/${mario}`,
    description: 'Nobody has reported Mario Kart World (Nintendo) on the Lichii Switch 2 emulator yet. Test it on your setup and share what happened.',
    gamePlatform: 'Nintendo Switch 2', publisher: { '@type': 'Organization', name: 'Nintendo' }, image: `${origin}/art/5483943-cover.webp`, datePublished: '2025-06-05',
  });
  assert.deepEqual(crumbs, { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Games', item: `${origin}/` },
    { '@type': 'ListItem', position: 2, name: 'Mario Kart World', item: `${origin}/games/${mario}` },
  ] });
  const report = structuredData((await get(`/reports/${visible}`)).body);
  assert.deepEqual(report.map(item => item['@type']), ['BreadcrumbList']);
  for (const url of ['/', `/games/${alphadia}`, `/reports/${visible}`]) assert.doesNotMatch((await get(url)).body, /aggregateRating|ratingValue|"Review"/, url);
});

test('game and report pages carry a server-rendered summary for clients without JavaScript', async () => {
  const game = noscriptOf((await get(`/games/${alphadia}`)).body);
  assert.ok(game.includes('<h1 class="page-title">Alphadia I &amp; II Nintendo Switch 2 Edition</h1>'));
  assert.ok(game.includes('<span class="status status-playable"><i aria-hidden="true"></i>Playable</span>'));
  assert.ok(game.includes(`<a href="/reports/${visible}">`));
  assert.ok(game.includes('<dt>Public reports</dt><dd>1</dd>'));
  const untested = noscriptOf((await get(`/games/${mario}`)).body);
  assert.ok(untested.includes('<span class="status status-untested"><i aria-hidden="true"></i>Untested</span>'));
  assert.ok(untested.includes('No reports for this game yet.'));
  const report = noscriptOf((await get(`/reports/${visible}`)).body);
  for (const text of ['<h2>What happened</h2>', fields.details, '<dt>Lichii build</dt><dd>build-93</dd>', `<a href="/games/${alphadia}">`]) assert.ok(report.includes(text), text);
  assert.equal(report.includes(fields.name), false);
});

test('robots.txt allows public pages, blocks private areas and points to the sitemap', async () => {
  const response = await get('/robots.txt');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'public, max-age=3600');
  const lines = response.body.split('\n');
  assert.equal(lines[0], 'User-agent: *');
  for (const path of ['/maintainer', '/submit', '/submitted/', '/api/auth/', '/api/maintainer/', '/api/v1/']) assert.ok(lines.includes(`Disallow: ${path}`), path);
  assert.ok(lines.includes('Allow: /'));
  assert.ok(lines.includes(`Sitemap: ${origin}/sitemap.xml`));
  for (const publicApi of ['/api/', '/api/games', '/api/reports', '/api/summary', '/games', '/reports']) assert.equal(lines.includes(`Disallow: ${publicApi}`), false, publicApi);
});

test('sitemap.xml lists the home page, guides, every game and visible reports with lastmod', async () => {
  const response = await get('/sitemap.xml');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/xml; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'public, max-age=900');
  assert.ok(response.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'));
  assert.ok(response.body.endsWith('</urlset>\n'));
  const urls = [...response.body.matchAll(/  <url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map(([, loc = '', lastmod]) => ({ loc, lastmod }));
  assert.equal(urls.length, response.body.split('<url>').length - 1);
  assert.equal(urls.length, 5 + catalog.length + 1);
  const locs = new Set(urls.map(url => url.loc));
  for (const path of ['/', '/reports', '/guide', '/guide/desktop', '/privacy', ...catalog.map(game => `/games/${game.slug}`)]) assert.ok(locs.has(origin + path), path);
  assert.deepEqual(urls.find(url => url.loc === `${origin}/reports/${visible}`), { loc: `${origin}/reports/${visible}`, lastmod: '2026-11-01T10:00:00.000Z' });
  assert.equal(urls.find(url => url.loc === `${origin}/games/${alphadia}`)?.lastmod, '2026-11-01T10:00:00.000Z');
  assert.equal(urls.find(url => url.loc === `${origin}/games/${mario}`)?.lastmod, undefined);
  assert.equal(response.body.includes(hidden), false);
  for (const path of ['/submit', '/submitted', '/maintainer', '/api/']) assert.equal([...locs].some(loc => loc.startsWith(origin + path)), false, path);
});

test('llms.txt follows the llmstxt.org layout and links only public resources', async () => {
  const response = await get('/llms.txt');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'public, max-age=900');
  const lines = response.body.split('\n');
  assert.equal(lines[0], '# Lichii Switch 2 compatibility');
  assert.equal(lines[1], '');
  assert.match(lines[2] ?? '', /^> Community compatibility reports for Nintendo Switch 2 games .* 565 catalog titles and 1 public report\./);
  assert.equal(lines.filter(line => line.startsWith('# ')).length, 1);
  const sections = lines.filter(line => line.startsWith('## '));
  assert.deepEqual(sections, ['## Pages', '## API', '## Most reported games', '## Optional']);
  const firstSection = lines.indexOf('## Pages');
  for (const line of lines.slice(firstSection).filter(line => line.startsWith('- '))) assert.match(line, /^- \[[^\]]+\]\(https:\/\/lichii\.example\/[^)\s]*\)(: .+)?$/, line);
  for (const path of ['/', '/reports', '/guide', '/guide/desktop', '/privacy', '/docs/desktop-api.md', '/sitemap.xml', '/llms-full.txt', `/games/${alphadia}.md`]) assert.ok(response.body.includes(`](${origin}${path})`), path);
  for (const secret of [fields.name, fields.cpu, 'HIDDEN_REPORT_SENTINEL', '/maintainer', '/submit']) assert.equal(response.body.includes(secret), false, secret);
});

test('llms-full.txt carries outcomes, the desktop API reference and every catalog game', async () => {
  const response = await get('/llms-full.txt');
  assert.equal(response.statusCode, 200);
  const lines = response.body.split('\n');
  assert.equal(lines.filter(line => line.startsWith('# ')).length, 1);
  assert.ok(lines.includes('## Desktop compatibility report API v1'));
  assert.ok(lines.includes('- Perfect: No issues found during your test.'));
  for (const game of catalog) assert.ok(response.body.includes(`(${origin}/games/${game.slug}.md)`), game.slug);
  assert.ok(lines.includes(`- [Alphadia I & II Nintendo Switch 2 Edition](${origin}/games/${alphadia}.md): Playable, 1 report`));
  for (const secret of [fields.name, 'HIDDEN_REPORT_SENTINEL']) assert.equal(response.body.includes(secret), false, secret);
});

test('game Markdown views and the desktop API reference are served as Markdown', async () => {
  const response = await get(`/games/${alphadia}.md`);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'public, max-age=900');
  assert.equal(response.headers.link, `<${origin}/games/${alphadia}>; rel="canonical"`);
  assert.ok(response.body.startsWith('# Alphadia I & II Nintendo Switch 2 Edition\n'));
  assert.ok(response.body.includes('- Status: Playable (latest visible report)'));
  assert.ok(response.body.includes(`- [Boots \\</script\\>\\<script\\>alert(1)\\</script\\> "fine" & 'ok'](${origin}/reports/${visible}): Playable · Build 93`));
  assert.equal(response.body.includes(fields.name), false);
  const docs = await get('/docs/desktop-api.md');
  assert.equal(docs.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.equal(docs.body, desktopApi);
});
