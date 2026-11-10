import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { buildLabel, lichiiBuild, setupSummary } from '../shared/compat.ts';
import { catalogEntrySchema, outcomeDescriptions, outcomes, reportFieldsSchema, statuses, type CatalogEntry } from '../shared/domain.ts';
import { hostingNotice } from '../shared/site-notice.ts';
import type { Config } from './config.ts';
import type { Database } from './db.ts';
import { aggregateGame, groupByGame, loadFacts, type ReportFact } from './insights.ts';

class Html { constructor(readonly value: string) {} }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
const fragment = (value: unknown): string => value instanceof Html ? value.value
  : Array.isArray(value) ? value.map(fragment).join('')
  : value === null || value === undefined || value === false ? '' : escapeHtml(String(value));
function html(strings: TemplateStringsArray, ...values: unknown[]) {
  return new Html(strings.reduce((out, string, index) => out + fragment(values[index - 1]) + string));
}
const jsonLd = (data: object) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const markdown = (value: string) => value.replace(/\s+/g, ' ').trim().replace(/([\\`*_[\]<>#|])/g, '\\$1');
function clip(value: string, max = 160) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const siteName = 'Lichii compatibility';
const htmlCache = 'no-cache';
const dataCache = 'public, max-age=900';
const staticCache = 'public, max-age=3600';

type Page = {
  status: number; title: string; description: string;
  path?: string; image?: string | null; largeImage?: boolean; jsonLd?: object[]; body: Html;
};

const desktopSteps = ['Play, then stop', 'Right-click the game', 'Pick the exact title', 'Review the draft', 'Tick both statements', 'Submit'];

async function loadCatalog(sql: Database) {
  return (await sql`SELECT catalog FROM games`).map(row => catalogEntrySchema.parse(row.catalog)).sort((a, b) => a.slug.localeCompare(b.slug));
}

async function loadGame(sql: Database, slug: string) {
  if (!slugPattern.test(slug)) return null;
  const rows = await sql`SELECT catalog FROM games WHERE slug = ${slug}`;
  if (!rows[0]) return null;
  const game = catalogEntrySchema.parse(rows[0].catalog);
  const facts = await loadFacts(sql, game.sgdbId);
  return { game, facts, ...aggregateGame(facts, []) };
}
type GameView = NonNullable<Awaited<ReturnType<typeof loadGame>>>;

const reportRow = z.object({ id: z.uuid(), fields: reportFieldsSchema, created_at: z.date(), game_title: z.string(), game_slug: z.string(), game_cover: z.string().nullable() });
async function loadReport(sql: Database, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const rows = await sql`SELECT r.id, r.fields, r.created_at, g.title AS game_title, g.slug AS game_slug, g.catalog->>'coverPath' AS game_cover
    FROM reports r JOIN games g ON g.sgdb_id = r.game_id WHERE r.id = ${id} AND r.triage <> 'hidden'`;
  return rows[0] ? reportRow.parse(rows[0]) : null;
}
type ReportView = z.infer<typeof reportRow>;

const bestText = (view: Pick<GameView, 'best'>) => !view.best ? 'Not tested yet' : view.best.outcome === 'Unplayable' ? 'No working report yet' : view.best.setup || 'Setup not given';
const statusChip = (value: string) => html`<span class="status status-${value.toLowerCase()}"><i aria-hidden="true"></i>${value}</span>`;
const factList = (rows: [string, string][]) => html`<dl class="facts">${rows.map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl>`;
const breadcrumbNav = (items: [string, string | null][]) => html`<nav aria-label="Breadcrumb" class="breadcrumbs"><a href="/">Games</a>${items.map(([label, to]) => html`<span>/ ${to ? html`<a href="${to}">${label}</a>` : html`<strong>${label}</strong>`}</span>`)}</nav>`;
const reportItem = (fact: ReportFact, game?: Pick<CatalogEntry, 'slug' | 'title'>) => html`<li>${statusChip(fact.outcome)} <a href="/reports/${fact.id}">${fact.summary}</a>${game ? html` · <a href="/games/${game.slug}">${game.title}</a>` : ''} <span class="muted">· ${buildLabel(fact.build)}${fact.setup ? ` · ${fact.setup}` : ''} · <time datetime="${fact.createdAt.toISOString()}">${isoDate(fact.createdAt)}</time></span></li>`;

function breadcrumbs(origin: string, items: [string, string][]) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], index) => ({ '@type': 'ListItem', position: index + 1, name, item: origin + path })) };
}

function head(page: Page, origin: string) {
  const url = page.path === undefined ? null : origin + page.path;
  const image = origin + (page.image ?? '/branding/lockup.png');
  const tags = [
    html`<title>${page.title}</title>`,
    html`<meta name="description" content="${page.description}" />`,
    html`<meta name="robots" content="${url ? 'index, follow' : 'noindex'}" />`,
    url && html`<link rel="canonical" href="${url}" />`,
    url && html`<meta property="og:url" content="${url}" />`,
    html`<meta property="og:site_name" content="${siteName}" />`,
    html`<meta property="og:type" content="website" />`,
    html`<meta property="og:title" content="${page.title}" />`,
    html`<meta property="og:description" content="${page.description}" />`,
    html`<meta property="og:image" content="${image}" />`,
    html`<meta name="twitter:card" content="${page.largeImage ? 'summary_large_image' : 'summary'}" />`,
    html`<meta name="twitter:title" content="${page.title}" />`,
    html`<meta name="twitter:description" content="${page.description}" />`,
    html`<meta name="twitter:image" content="${image}" />`,
    ...(page.jsonLd ?? []).map(data => html`<script type="application/ld+json">${new Html(jsonLd(data))}</script>`),
  ];
  return new Html(tags.filter(tag => tag instanceof Html).map(tag => tag.value).join('\n    '));
}

function noscript(body: Html) {
  return html`<noscript><section class="site-notice" aria-label="Hosting notice"><div class="site-notice-inner"><span class="site-notice-label">Notice</span><p>${hostingNotice}</p></div></section><header class="site-header"><div class="header-inner"><a href="/" class="brand"><img src="/branding/lockup.png" width="122" height="56" alt="Lichii" /><span>compat · Switch 2</span></a><nav aria-label="Main navigation"><a href="/">Games</a><a href="/reports">Recent reports</a><a href="/guide">How to report</a></nav></div></header><main class="page noscript-page">${body}</main><footer class="site-footer"><p>Lichii is an independent, experimental emulator, not affiliated with Nintendo.</p><div><a href="/privacy">Privacy &amp; safety</a></div></footer></noscript>`;
}

function prepareTemplate(source: string) {
  const marker = '<!--seo-head-->';
  const prepared = source.replace(/<meta name="description"[^>]*>/, marker).replace(/\s*<title>[^<]*<\/title>/, '');
  const root = '<div id="root"></div>';
  const headAt = prepared.indexOf(marker);
  const rootAt = prepared.indexOf(root);
  if (headAt < 0 || rootAt < headAt || /<title>/.test(prepared)) throw new Error('index.html needs one description meta tag, one title and an empty #root.');
  return (headHtml: Html, bodyHtml: Html) => prepared.slice(0, headAt) + headHtml.value + prepared.slice(headAt + marker.length, rootAt) + bodyHtml.value + prepared.slice(rootAt);
}

export async function registerSite(app: FastifyInstance, sql: Database, config: Config, distRoot: string) {
  const render = prepareTemplate(await readFile(join(distRoot, 'index.html'), 'utf8'));
  const desktopApi = await readFile(new URL('../docs/desktop-api.md', import.meta.url), 'utf8');
  const origin = config.APP_ORIGIN;

  const notFound: Page = { status: 404, title: 'Page not found · Lichii', description: 'This page does not exist on the Lichii compatibility site.', body: html`<div class="empty"><h1>Page not found</h1><p>This page may have moved.</p><a class="button" href="/">Back to games</a></div>` };
  const privatePage = (title: string, description: string): Page => ({ status: 200, title: `${title} · Lichii`, description, body: html`<h1 class="page-title">${title}</h1><p class="page-description">This page needs JavaScript.</p>` });

  async function respond(request: FastifyRequest, reply: FastifyReply, load: () => Promise<Page>) {
    let page: Page;
    try { page = await load(); }
    catch {
      app.log.error({ requestId: request.id }, 'Page metadata failed');
      page = { status: 503, title: 'Lichii · Switch 2 compatibility', description: 'Community compatibility reports for Nintendo Switch 2 games on Lichii.', body: html`<h1 class="page-title">Temporarily unavailable</h1><p class="page-description">Please try again in a moment.</p>` };
    }
    const [pathname = '', query] = request.url.split(/\?(.*)/s);
    if (page.status === 200 && page.path !== undefined && pathname !== page.path) return reply.redirect(page.path + (query ? `?${query}` : ''), 301);
    if (page.path === undefined) reply.header('X-Robots-Tag', 'noindex');
    return reply.code(page.status).header('Cache-Control', htmlCache).type('text/html; charset=utf-8').send(render(head(page, origin), noscript(page.body)));
  }

  async function homePage(): Promise<Page> {
    const [games, facts] = await Promise.all([loadCatalog(sql), loadFacts(sql)]);
    const bySgdb = new Map(games.map(game => [game.sgdbId, game]));
    const perGame = groupByGame(facts);
    const counts = Object.fromEntries(statuses.map(value => [value, 0])) as Record<(typeof statuses)[number], number>;
    for (const game of games) counts[perGame.get(game.sgdbId)?.[0]?.outcome ?? 'Untested']++;
    const reportsFor = (game: CatalogEntry) => perGame.get(game.sgdbId) ?? [];
    const tested = games.filter(game => reportsFor(game).length).sort((a, b) => reportsFor(b).length - reportsFor(a).length || a.title.localeCompare(b.title)).slice(0, 15);
    const description = `Community compatibility reports for ${games.length} Nintendo Switch 2 games on the Lichii emulator. ${facts.length ? `${count(facts.length, 'public report')} so far: find your game, compare setups and builds, and share what happened.` : 'No reports yet: every title is untested until a player shares a real test.'}`;
    return {
      status: 200, path: '/', title: `Lichii Switch 2 compatibility: community reports for ${games.length} games`, description,
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: siteName, url: `${origin}/`, description,
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } }],
      body: html`<section><h1 class="page-title">Will it run?</h1><p class="page-description">Players test Switch 2 games on Lichii and report what happened, along with their build, game version, CPU, GPU, driver and settings.</p>
        <p><strong>${games.length} Switch 2 titles tracked · ${count(facts.length, 'community report')}</strong></p>
        <ul class="noscript-list">${statuses.map(value => html`<li>${statusChip(value)} ${counts[value]}</li>`)}</ul></section>
        <section><h2>Latest results</h2>${facts.length ? html`<ul class="noscript-list">${facts.slice(0, 8).map(fact => reportItem(fact, bySgdb.get(fact.gameId)))}</ul>` : html`<p class="muted">No results have been submitted yet.</p>`}</section>
        ${tested.length ? html`<section><h2>Most reported games</h2><ul class="noscript-list">${tested.map(game => html`<li><a href="/games/${game.slug}">${game.title}</a> ${statusChip(reportsFor(game)[0]?.outcome ?? 'Untested')} <span class="muted">· ${count(reportsFor(game).length, 'report')}</span></li>`)}</ul></section>` : ''}
        <p class="muted">Search and filters need JavaScript. <a href="/reports">Recent reports</a> · <a href="/guide">How to report</a></p>`,
    };
  }

  function gamePage(view: GameView): Page {
    const { game, facts, status, median, reportCount } = view;
    const path = `/games/${game.slug}`;
    const title = `${game.title} on Lichii: ${status === 'Untested' ? 'untested' : status} · Switch 2 compatibility`;
    const description = reportCount
      ? `Latest community result for ${game.title} on the Lichii Switch 2 emulator: ${status}. ${count(reportCount, 'public report')}${median && reportCount > 1 ? `, median ${median}` : ''}${view.best && view.best.outcome !== 'Unplayable' && view.best.setup ? `, best on ${view.best.setup}` : ''}. Compare builds, hardware and settings.`
      : `Nobody has reported ${game.title}${game.publisher ? ` (${game.publisher})` : ''} on the Lichii Switch 2 emulator yet. Test it on your setup and share what happened.`;
    const released = game.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(game.releaseDate) && game.releaseDate <= isoDate(new Date()) ? game.releaseDate : null;
    return {
      status: 200, path, title, description, image: game.heroPath ?? game.coverPath, largeImage: Boolean(game.heroPath),
      jsonLd: [
        { '@context': 'https://schema.org', '@type': 'VideoGame', name: game.title, url: origin + path, description, gamePlatform: 'Nintendo Switch 2',
          ...(game.publisher ? { publisher: { '@type': 'Organization', name: game.publisher } } : {}),
          ...(game.coverPath ? { image: origin + game.coverPath } : {}), ...(released ? { datePublished: released } : {}) },
        breadcrumbs(origin, [['Games', '/'], [game.title, path]]),
      ],
      body: html`${breadcrumbNav([[game.title, null]])}<h1 class="page-title">${game.title}</h1>
        <p class="muted">Nintendo Switch 2${game.publisher ? ` · ${game.publisher}` : ''}</p>
        <p class="noscript-status">${reportCount ? 'Latest community result' : 'Current status'}: ${statusChip(status)}</p>
        <p>${reportCount ? `Latest of ${count(reportCount, 'report')}.${median && reportCount > 1 ? ` Median result: ${median}.` : ''} Read individual reports before drawing conclusions.` : 'Nobody has reported a test yet. We don’t know how this game runs on Lichii.'}</p>
        ${factList([['Public reports', String(reportCount)], ['Median result', median ?? 'No reports yet'], ['Best result on', bestText(view)], ['Latest version tested', view.latestVersion ?? 'Not tested'], ['Latest report', view.latestAt?.slice(0, 10) ?? 'Not tested'], ['Publisher', game.publisher ?? 'Not recorded'], ['Release date', game.releaseDate ?? 'Not recorded']])}
        <section><h2>Community reports</h2>${facts.length ? html`<ul class="noscript-list">${facts.slice(0, 30).map(fact => reportItem(fact))}</ul>` : html`<p class="muted">No reports for this game yet.</p>`}</section>
        <p><a class="button primary" href="/submit?game=${game.slug}">Submit a report</a> <a class="text-link" href="${path}.md">Markdown version</a></p>`,
    };
  }

  function reportPage(report: ReportView): Page {
    const fields = report.fields;
    const path = `/reports/${report.id}`;
    const gamePath = `/games/${report.game_slug}`;
    const build = buildLabel(lichiiBuild(fields.build));
    const setup = setupSummary(fields);
    return {
      status: 200, path, title: `${clip(fields.summary, 70)} · ${report.game_title} (${fields.outcome}) · Lichii`,
      description: clip(`${fields.outcome} on ${build}${setup ? ` · ${setup}` : ''}: ${fields.details}`),
      image: report.game_cover,
      jsonLd: [breadcrumbs(origin, [['Games', '/'], [report.game_title, gamePath], ['Community report', path]])],
      body: html`${breadcrumbNav([[report.game_title, gamePath], ['Community report', null]])}
        <p class="noscript-status">${statusChip(fields.outcome)} <a href="${gamePath}">${report.game_title}</a> <time datetime="${report.created_at.toISOString()}">${isoDate(report.created_at)}</time></p>
        <h1 class="page-title">${fields.summary}</h1>
        <section><h2>What happened</h2><p class="preserve-lines">${fields.details}</p></section>
        <section><h2>How far they got</h2><p class="preserve-lines">${fields.progress}</p></section>
        <section><h2>Steps to reproduce</h2><p class="preserve-lines">${fields.reproduction || 'No reproduction steps supplied.'}</p></section>
        <section><h2>Settings</h2><p class="preserve-lines">${fields.settings}</p></section>
        <section><h2>Tested on this setup</h2>${factList([['Lichii build', fields.build], ['Build section', build], ['Game version', fields.gameVersion], ['CPU', fields.cpu], ['GPU', fields.gpu], ['GPU driver', fields.driver], ['Operating system', fields.os], ['RAM', fields.ram || 'Not supplied'], ['Graphics API', fields.graphicsApi]])}</section>`,
    };
  }

  app.get('/', (request, reply) => respond(request, reply, homePage));
  app.get('/reports', (request, reply) => respond(request, reply, async () => {
    const [games, facts] = await Promise.all([loadCatalog(sql), loadFacts(sql)]);
    const bySgdb = new Map(games.map(game => [game.sgdbId, game]));
    return {
      status: 200, path: '/reports', title: 'Recent Switch 2 compatibility reports · Lichii',
      description: `Every public Switch 2 compatibility report players submitted for Lichii, newest first, with build, hardware, settings and outcome. ${count(facts.length, 'report')} so far.`,
      body: html`<h1 class="page-title">Recent reports</h1><p class="page-description">Every report players submitted, newest first.</p>
        ${facts.length ? html`<ul class="noscript-list">${facts.slice(0, 15).map(fact => reportItem(fact, bySgdb.get(fact.gameId)))}</ul>` : html`<p class="muted">No reports yet.</p>`}`,
    };
  }));
  app.get('/games/:slug', async (request, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(request.params);
    if (!slug.endsWith('.md')) return respond(request, reply, async () => { const view = await loadGame(sql, slug); return view ? gamePage(view) : notFound; });
    const view = await loadGame(sql, slug.slice(0, -3));
    if (!view) return reply.code(404).send({ error: 'Not found.' });
    return reply.header('Cache-Control', dataCache).header('Link', `<${origin}/games/${view.game.slug}>; rel="canonical"`).type('text/markdown; charset=utf-8').send(gameMarkdown(view));
  });
  app.get('/reports/:id', (request, reply) => respond(request, reply, async () => {
    const report = await loadReport(sql, z.object({ id: z.string() }).parse(request.params).id);
    return report ? reportPage(report) : notFound;
  }));
  app.get('/guide', (request, reply) => respond(request, reply, async () => ({
    status: 200, path: '/guide', title: 'How to report a Switch 2 game on Lichii',
    description: 'Write a useful Lichii compatibility report: reproduce the result, find eden_log.txt, check your build and hardware, pick an outcome and know what stays private.',
    body: html`<h1 class="page-title">You play. Tell us what happened.</h1><p class="page-description">No account. No elaborate benchmark. Just your setup, what you tried, and where it worked or went wrong.</p>
      <ol class="noscript-list"><li>Start with a clean test.</li><li>Find your log file: File → Open Lichii Folders → Log Folder → eden_log.txt.</li><li>Check the build and hardware.</li><li>Pick the result that fits.</li><li>Be specific about what happened.</li><li>Know what you’re sharing: the log stays private to the maintainer.</li></ol>
      <h2>Outcomes</h2><ul class="noscript-list">${outcomes.map(outcome => html`<li>${statusChip(outcome)} ${outcomeDescriptions[outcome]}</li>`)}</ul>
      <p><a href="/guide/desktop">Reporting from the Lichii desktop app</a> · <a href="/privacy">Privacy details</a></p>`,
  })));
  app.get('/guide/desktop', (request, reply) => respond(request, reply, async () => ({
    status: 200, path: '/guide/desktop', title: 'Report from the Lichii desktop app in six steps · Lichii',
    description: 'An illustrated walkthrough for sending an opt-in compatibility report from the Lichii desktop app: play, right-click the game, pick the title, review, consent and submit.',
    jsonLd: [breadcrumbs(origin, [['How to report', '/guide'], ['Lichii desktop app', '/guide/desktop']])],
    body: html`<nav aria-label="Breadcrumb" class="breadcrumbs"><a href="/">Games</a><span>/ <a href="/guide">How to report</a></span><span>/ <strong>Lichii desktop app</strong></span></nav><h1 class="page-title">Report from Lichii in six steps.</h1>
      <ol class="noscript-list">${desktopSteps.map(step => html`<li>${step}</li>`)}</ol>`,
  })));
  app.get('/privacy', (request, reply) => respond(request, reply, async () => ({
    status: 200, path: '/privacy', title: 'Privacy & safety · Lichii compatibility',
    description: 'What the Lichii compatibility site stores, who can see it, how analytics and private logs work, and how to request removal.',
    body: html`<h1 class="page-title">Privacy &amp; safety</h1><p class="page-description">What this site stores, who can see it, and how to request removal.</p>
      <p>Reports publish your display name, optional X handle, report text, versions, hardware, settings and outcome. Optional logs are private to the maintainer and expire after 90 days. Analytics stays off with Do Not Track or Global Privacy Control, and never loads on submission or maintainer pages.</p>`,
  })));
  app.get('/submit', (request, reply) => respond(request, reply, async () => privatePage('Submit a report', 'Share a real Switch 2 test on Lichii.')));
  app.get('/submitted/:id', (request, reply) => respond(request, reply, async () => privatePage('Report submitted', 'Thanks for testing.')));
  app.get('/maintainer', (request, reply) => respond(request, reply, async () => privatePage('Maintainer access', 'Maintainer sign-in.')));

  app.get('/robots.txt', (_request, reply) => reply.header('Cache-Control', staticCache).type('text/plain; charset=utf-8').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /maintainer',
    'Disallow: /submit',
    'Disallow: /submitted/',
    'Disallow: /api/auth/',
    'Disallow: /api/maintainer/',
    'Disallow: /api/v1/',
    '# Public read APIs stay crawlable so search engines can render game and report pages.',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')));

  app.get('/sitemap.xml', async (_request, reply) => {
    const [games, facts] = await Promise.all([loadCatalog(sql), loadFacts(sql)]);
    const perGame = groupByGame(facts);
    const newest = facts[0]?.createdAt;
    const entries: [string, Date | undefined][] = [
      ['/', newest], ['/reports', newest], ['/guide', undefined], ['/guide/desktop', undefined], ['/privacy', undefined],
      ...games.map((game): [string, Date | undefined] => [`/games/${game.slug}`, perGame.get(game.sgdbId)?.[0]?.createdAt]),
      ...facts.map((fact): [string, Date] => [`/reports/${fact.id}`, fact.createdAt]),
    ];
    const urls = entries.map(([path, lastmod]) => `  <url><loc>${escapeHtml(origin + path)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}</url>`);
    return reply.header('Cache-Control', dataCache).type('application/xml; charset=utf-8')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  });

  const intro = (games: number, reports: number) => [
    '# Lichii Switch 2 compatibility',
    '',
    `> Community compatibility reports for Nintendo Switch 2 games running on Lichii, an independent, experimental emulator that is not affiliated with Nintendo. The site tracks ${games} catalog titles and ${count(reports, 'public report')}. Every title stays Untested until a player submits a real report.`,
    '',
    "Each report records the Lichii build, game version, CPU, GPU, driver, operating system, settings and the player's own outcome: Perfect, Playable, Runs, Loads or Unplayable. A game's status is its latest visible report. Its median takes the lower middle rating, so it never overstates compatibility. The site never generates players, statistics, performance figures or logs. Every game page has a Markdown view at `/games/<slug>.md`.",
    '',
  ];
  const pagesSection = [
    '## Pages',
    '',
    `- [Games database](${origin}/): Search the catalog and compare status, median and best setup per game`,
    `- [Recent reports](${origin}/reports): Every public report, newest first`,
    `- [How to report](${origin}/guide): Steps for a useful report, outcome definitions and what stays private`,
    `- [Desktop app guide](${origin}/guide/desktop): Report from the Lichii desktop app in six steps`,
    `- [Privacy & safety](${origin}/privacy): What is public, what stays private, analytics and removal requests`,
    '',
    '## API',
    '',
    `- [Desktop report API v1](${origin}/docs/desktop-api.md): Catalog lookup, the anonymous opt-in native report endpoint, consents, limits and duplicate-safe retries`,
    `- [Sitemap](${origin}/sitemap.xml): Every public game and report page with its last report date`,
    '',
  ];
  const gameLine = (game: CatalogEntry, facts: readonly ReportFact[]) => {
    const view = aggregateGame(facts, []);
    return `- [${markdown(game.title)}](${origin}/games/${game.slug}.md): ${view.status}, ${count(view.reportCount, 'report')}${view.median && view.reportCount > 1 ? `, median ${view.median}` : ''}`;
  };

  app.get('/llms.txt', async (_request, reply) => {
    const [games, facts] = await Promise.all([loadCatalog(sql), loadFacts(sql)]);
    const perGame = groupByGame(facts);
    const reportsFor = (game: CatalogEntry) => perGame.get(game.sgdbId) ?? [];
    const tested = games.filter(game => reportsFor(game).length).sort((a, b) => reportsFor(b).length - reportsFor(a).length || a.title.localeCompare(b.title)).slice(0, 25);
    return reply.header('Cache-Control', dataCache).type('text/plain; charset=utf-8').send([
      ...intro(games.length, facts.length), ...pagesSection,
      ...(tested.length ? ['## Most reported games', '', ...tested.map(game => gameLine(game, reportsFor(game))), ''] : []),
      '## Optional', '',
      `- [Full content](${origin}/llms-full.txt): Outcome definitions, reporting and privacy summaries, the desktop API reference and every catalog game with its status`,
      '',
    ].join('\n'));
  });

  app.get('/llms-full.txt', async (_request, reply) => {
    const [games, facts] = await Promise.all([loadCatalog(sql), loadFacts(sql)]);
    const perGame = groupByGame(facts);
    let fenced = false;
    const apiReference = desktopApi.trim().split('\n').map(line => {
      if (line.startsWith('```')) fenced = !fenced;
      return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line;
    });
    return reply.header('Cache-Control', dataCache).type('text/plain; charset=utf-8').send([
      ...intro(games.length, facts.length), ...pagesSection,
      '## Outcomes', '',
      ...outcomes.map(outcome => `- ${outcome}: ${outcomeDescriptions[outcome]}`),
      '- Untested: No report yet. This is a catalog state, not an outcome a player can submit.',
      '',
      '## How to report', '',
      "Reports need no account, just a display name. Test with mods and cheats disabled when possible, reproduce any bug, then note the exact Lichii build, game version, CPU, GPU, driver, operating system and settings. In the browser form, the optional `eden_log.txt` (File → Open Lichii Folders → Log Folder) is read locally to suggest those fields, and the player reviews them. The outcome, progress and reproduction steps are always the player's own judgment. The Lichii desktop app can send the same report through the desktop API after the player reviews the draft and ticks both consent statements.",
      '',
      '## Privacy', '',
      'Public reports show the display name, optional X handle, report text, versions, hardware, settings, outcome and date. Optional logs are private to the maintainer, never appear in public pages or APIs, and expire after 90 days. Analytics never loads on submission or maintainer pages and stays off with Do Not Track or Global Privacy Control. Removal requests go to zortos293 on GitHub with the report URL.',
      '',
      ...apiReference, '',
      '## Games', '',
      `All ${games.length} catalog titles. Links point to each game's Markdown view.`, '',
      ...games.map(game => gameLine(game, perGame.get(game.sgdbId) ?? [])),
      '',
    ].join('\n'));
  });

  app.get('/docs/desktop-api.md', (_request, reply) => reply.header('Cache-Control', staticCache).type('text/markdown; charset=utf-8').send(desktopApi));

  function gameMarkdown(view: GameView) {
    const { game, facts } = view;
    return [
      `# ${markdown(game.title)}`,
      '',
      `> Lichii compatibility for ${markdown(game.title)} on Nintendo Switch 2: latest community result ${view.status}, ${count(view.reportCount, 'public report')}.`,
      '',
      `- Status: ${view.status} (latest visible report)`,
      `- Median result: ${view.median ?? 'No reports yet'}`,
      `- Best result on: ${markdown(bestText(view))}`,
      `- Latest version tested: ${markdown(view.latestVersion ?? 'Not tested')}`,
      `- Latest report: ${view.latestAt?.slice(0, 10) ?? 'Not tested'}`,
      `- Publisher: ${markdown(game.publisher ?? 'Not recorded')}`,
      `- Release date: ${game.releaseDate ?? 'Not recorded'}`,
      `- Web page: ${origin}/games/${game.slug}`,
      `- Submit a report: ${origin}/submit?game=${game.slug}`,
      '',
      'Outcomes, best to worst: Perfect, Playable, Runs, Loads, Unplayable. Untested means no report yet.',
      '',
      '## Reports',
      '',
      ...(facts.length
        ? facts.slice(0, 50).map(fact => `- [${markdown(fact.summary)}](${origin}/reports/${fact.id}): ${fact.outcome} · ${buildLabel(fact.build)}${fact.setup ? ` · ${markdown(fact.setup)}` : ''} · ${isoDate(fact.createdAt)}`)
        : ['No reports yet.']),
      '',
    ].join('\n');
  }

  app.setNotFoundHandler((request, reply) => {
    const [pathname = '', query] = request.url.split(/\?(.*)/s);
    const readable = request.method === 'GET' || request.method === 'HEAD';
    if (readable && pathname === '/index.html') return reply.redirect('/', 301);
    if (readable && !pathname.startsWith('/api/') && /^(\/[A-Za-z0-9-]+)+\/$/.test(pathname)) return reply.redirect(pathname.slice(0, -1) + (query ? `?${query}` : ''), 301);
    if (pathname.startsWith('/api/') || request.method !== 'GET' || pathname.includes('.')) return reply.code(404).send({ error: 'Not found.' });
    return respond(request, reply, async () => notFound);
  });
}
