import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import staticFiles from '@fastify/static';
import { trackAgents } from '@databuddy/sdk/agents';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { z } from 'zod';
import { catalogEntrySchema, desktopSubmissionSchema, gameSchema, platformSchema, publicReportSchema, reportFieldsSchema, submissionSchema, summaryResponseSchema, triageSchema, maintainerReportSchema } from '../shared/domain.ts';
import { validateLog } from '../shared/log.ts';
import type { Config } from './config.ts';
import type { Database } from './db.ts';
import { authHandlers } from './auth.ts';
import { aggregateGame, buildColumns, groupByGame, hasReportFilter, latestBuild, loadFacts, matchesFilter, summarize, type ReportFilter } from './insights.ts';
import { registerSite } from './seo.ts';

const querySchema = z.object({
  q: z.string().trim().max(150).default(''),
  status: z.enum(['Any', 'Perfect', 'Playable', 'Runs', 'Loads', 'Unplayable', 'Untested']).default('Any'),
  gpu: z.string().trim().max(100).default(''), os: z.string().trim().max(100).default(''),
  build: z.string().trim().max(100).default(''),
  platform: z.string().trim().max(80).default('').transform(value => value ? [...new Set(value.split(','))] : []).pipe(z.array(platformSchema)),
  lichiiBuild: z.union([z.literal(''), z.literal('other'), z.string().regex(/^\d{1,4}$/).transform(Number)]).default(''),
  sort: z.enum(['popular', 'title', 'recent']).default('popular'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  gameId: z.coerce.number().int().positive().optional(),
});
type ListQuery = z.infer<typeof querySchema>;
const reportFilter = (q: ListQuery): ReportFilter => ({ platforms: q.platform, build: q.lichiiBuild === '' ? null : q.lichiiBuild, gpu: q.gpu, os: q.os, buildText: q.build });
const pinnedGames = [5483943, 5483961, 5483963];
const pinRank = (id: number) => pinnedGames.includes(id) ? pinnedGames.indexOf(id) : pinnedGames.length;
const byTitle = (a: { title: string; sgdbId: number }, b: { title: string; sgdbId: number }) => a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : a.sgdbId - b.sgdbId;
const uuidParams = z.object({ id: z.uuid() });
const desktopReportPath = '/api/v1/desktop/reports';
const desktopHeaders = z.object({ 'idempotency-key': z.uuid() });
type SubmissionResult = { kind: 'created' | 'replayed'; id: string } | { kind: 'conflict' } | { kind: 'limited' };
const agentHeaders = ['user-agent', 'accept', 'signature-agent', 'sec-fetch-mode', 'referer'] as const;

export async function createApp(config: Config, sql: Database, serveStatic = true, reportAgent = trackAgents) {
  const app = Fastify({
    logger: { level: 'warn', serializers: { req: () => ({}), res: () => ({}), err: () => ({ type: 'Error', message: 'Request failed', stack: '' }) } },
    disableRequestLogging: true,
    bodyLimit: 1100 * 1024,
    requestTimeout: 15000,
    connectionTimeout: 20000,
    trustProxy: false,
    routerOptions: { maxParamLength: 200 },
  });
  const host = new URL(config.APP_ORIGIN).host;
  app.addHook('onRequest', (request, _reply, done) => {
    if (request.headers.dnt !== '1' && request.headers['sec-gpc'] !== '1') {
      const headers = Object.fromEntries(agentHeaders.map(name => [name, request.headers[name]]));
      void reportAgent({ method: request.method, url: request.url, headers: { ...headers, host } }, { websiteId: config.DATABUDDY_WEBSITE_ID }).catch(() => {});
    }
    done();
  });
  await app.register(cookie, { secret: config.COOKIE_SECRET });
  await app.register(helmet, {
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://cdn.databuddy.cc'], styleSrc: ["'self'"], imgSrc: ["'self'"],
      fontSrc: ["'self'"], connectSrc: ["'self'", 'https://basket.databuddy.cc'], objectSrc: ["'none'"], frameAncestors: ["'none'"],
      baseUri: ["'none'"], formAction: ["'self'"], upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
    } },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: config.NODE_ENV === 'production' ? { maxAge: 31536000 } : false,
  });
  app.addHook('onRequest', async (request, reply) => {
    const path = request.routeOptions.url ?? request.url.split('?')[0] ?? '';
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (path.startsWith('/api/')) reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      if (path === desktopReportPath) {
        if (request.headers['x-lichii-client'] !== 'desktop/1'
          || ['origin', 'cookie', 'authorization'].some(name => request.headers[name] !== undefined)
          || Object.keys(request.headers).some(name => name.startsWith('sec-fetch-'))) return reply.code(403).send({ error: 'Use the anonymous Lichii desktop submission protocol.' });
      } else {
        if (request.headers.origin !== config.APP_ORIGIN) return reply.code(403).send({ error: 'This request must come from the Lichii website.' });
        if (request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Cross-site requests are not allowed.' });
      }
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return reply.code(415).send({ error: 'Send application/json.' });
    }
    if (!path.startsWith('/api/') || path === '/api/health') return;
    const submitting = request.method === 'POST' && (path === '/api/reports' || path === desktopReportPath);
    const auth = path === '/api/auth/login';
    const period = submitting || auth ? 3600 : 60;
    const limit = submitting ? 5 : auth ? 20 : 240;
    const bucket = Math.floor(Date.now() / (period * 1000));
    const edgeIp = request.headers['x-real-ip'];
    if (config.TRUST_PROXY === 'true' && (typeof edgeIp !== 'string' || !isIP(edgeIp))) return reply.code(400).send({ error: 'A valid trusted proxy address is required.' });
    const ip = config.TRUST_PROXY === 'true' && typeof edgeIp === 'string' ? edgeIp : request.ip;
    const key = createHmac('sha256', config.RATE_LIMIT_SECRET).update(`${ip}:${submitting ? 'submit' : auth ? 'auth' : 'read'}:${bucket}`).digest('hex');
    const rows = await sql`INSERT INTO rate_limits(key, count, expires_at) VALUES (${key}, 1, now() + ${period} * interval '1 second')
      ON CONFLICT(key) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`;
    if (Number(rows[0]?.count) > limit) return reply.header('Retry-After', String(period)).code(429).send({ error: 'Too many requests. Please try again later.' });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Check the highlighted fields.', fields: error.flatten().fieldErrors });
    const code = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (code >= 500) app.log.error({ requestId: request.id }, 'Request failed');
    return reply.code(code >= 400 && code < 600 ? code : 500).send({ error: code === 413 ? 'The request is too large. Logs must be 512 KB or smaller.' : code === 400 ? 'The request could not be read.' : code === 415 ? 'Unsupported request format.' : 'The service is temporarily unavailable. Please try again.' });
  });
  const auth = authHandlers(sql, config);
  await auth.register(app);

  app.get('/api/health', async (_request, reply) => {
    try { await sql`SELECT 1 FROM games LIMIT 1`; return { ok: true }; }
    catch { return reply.code(503).send({ ok: false }); }
  });

  app.get('/api/games', async request => {
    const q = querySchema.parse(request.query);
    const filter = reportFilter(q);
    const [catalog, facts] = await Promise.all([sql`SELECT catalog FROM games`, loadFacts(sql)]);
    const columns = buildColumns(facts);
    const latestByGame = groupByGame(facts);
    const matching = groupByGame(facts.filter(matchesFilter(filter)));
    const games = catalog.map(row => catalogEntrySchema.parse(row.catalog));
    const counts = { Perfect: 0, Playable: 0, Runs: 0, Loads: 0, Unplayable: 0, Untested: 0 };
    for (const game of games) counts[latestByGame.get(game.sgdbId)?.[0]?.outcome ?? 'Untested']++;
    const needle = q.q.toLowerCase();
    const filtered = hasReportFilter(filter);
    const rows = games.map(game => ({ ...game, ...aggregateGame(matching.get(game.sgdbId) ?? [], columns) }))
      .filter(game => (!filtered || game.reportCount > 0) && `${game.title} ${game.publisher ?? ''}`.toLowerCase().includes(needle) && (q.status === 'Any' || game.status === q.status));
    rows.sort(q.sort === 'title' ? byTitle
      : q.sort === 'recent' ? (a, b) => (b.latestAt ?? '').localeCompare(a.latestAt ?? '') || byTitle(a, b)
      : (a, b) => b.reportCount - a.reportCount || pinRank(a.sgdbId) - pinRank(b.sgdbId) || byTitle(a, b));
    return {
      games: rows.slice((q.page - 1) * 15, q.page * 15).map(game => gameSchema.parse(game)), page: q.page, pageCount: Math.max(1, Math.ceil(rows.length / 15)), total: rows.length,
      totalGames: games.length, totalReports: facts.length, counts, latestBuild: latestBuild(facts),
    };
  });

  app.get('/api/games/:slug', async (request, reply) => {
    const { slug } = z.object({ slug: z.string().max(180) }).parse(request.params);
    const [rows, facts] = await Promise.all([sql`SELECT catalog FROM games WHERE slug = ${slug}`, loadFacts(sql)]);
    if (!rows[0]) return reply.code(404).send({ error: 'Game not found.' });
    const game = catalogEntrySchema.parse(rows[0].catalog);
    return gameSchema.parse({ ...game, ...aggregateGame(facts.filter(fact => fact.gameId === game.sgdbId), buildColumns(facts)) });
  });

  app.get('/api/summary', async request => {
    const q = querySchema.parse(request.query);
    const scope = await loadFacts(sql, q.gameId);
    return summaryResponseSchema.parse(summarize(scope.filter(matchesFilter(reportFilter(q))), scope));
  });

  const publicColumns = sql`r.id, r.fields, r.created_at, r.triage, g.title AS game_title, g.slug AS game_slug, g.catalog->>'coverPath' AS game_cover`;
  const mapReport = (row: Record<string, unknown>) => publicReportSchema.parse({
    ...reportFieldsSchema.parse(row.fields), id: row.id, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : '', triage: row.triage,
    gameTitle: row.game_title, gameSlug: row.game_slug, gameCoverPath: row.game_cover,
  });

  app.get('/api/reports', async request => {
    const q = querySchema.parse(request.query);
    const filter = matchesFilter(reportFilter(q));
    const facts = (await loadFacts(sql, q.gameId)).filter(fact => filter(fact) && (q.status === 'Any' || fact.outcome === q.status)
      && `${fact.title} ${fact.summary}`.toLowerCase().includes(q.q.toLowerCase()));
    const ids = facts.slice((q.page - 1) * 15, q.page * 15).map(fact => fact.id);
    const rows = ids.length ? await sql`SELECT ${publicColumns} FROM reports r JOIN games g ON g.sgdb_id = r.game_id WHERE r.id IN ${sql(ids)} ORDER BY r.created_at DESC, r.id DESC` : [];
    return { reports: rows.map(mapReport), page: q.page, pageCount: Math.max(1, Math.ceil(facts.length / 15)), total: facts.length };
  });

  app.get('/api/reports/:id', async (request, reply) => {
    const { id } = uuidParams.parse(request.params);
    const rows = await sql`SELECT ${publicColumns} FROM reports r JOIN games g ON g.sgdb_id = r.game_id WHERE r.id = ${id} AND r.triage <> 'hidden'`;
    if (!rows[0]) return reply.code(404).send({ error: 'Report not found.' });
    return mapReport(rows[0]);
  });

  async function submitReport(request: FastifyRequest, reply: FastifyReply) {
    const desktop = request.routeOptions.url === desktopReportPath;
    const key = desktop ? desktopHeaders.parse(request.headers)['idempotency-key'].toLowerCase() : null;
    const data = desktop ? { ...desktopSubmissionSchema.parse(request.body), log: null, privateLogConsent: false, website: '' } : submissionSchema.parse(request.body);
    if (data.log) {
      const problem = validateLog(data.log.text);
      if (problem) return reply.code(400).send({ error: problem, fields: { log: [problem] } });
    }
    const game = await sql`SELECT sgdb_id FROM games WHERE sgdb_id = ${data.gameId}`;
    if (!game.length) return reply.code(400).send({ error: 'Choose a game in the Switch 2 catalog.' });
    const { log, publicConsent, safeFilesConsent, privateLogConsent, website, ...fields } = data;
    const requestHash = desktop ? createHash('sha256').update(JSON.stringify(data)).digest('hex') : null;
    const id = randomUUID();
    const day = Math.floor(Date.now() / 86400000);
    const stored = await sql.begin(async (tx): Promise<SubmissionResult> => {
      if (key) {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        const previous = await tx`SELECT id, desktop_submission_hash FROM reports WHERE desktop_submission_key = ${key}`;
        if (previous[0]) return previous[0].desktop_submission_hash === requestHash ? { kind: 'replayed', id: z.uuid().parse(previous[0].id) } : { kind: 'conflict' };
      }
      const volume = await tx`INSERT INTO rate_limits(key, count, expires_at) VALUES (${`global-submit:${day}`}, 1, now() + interval '1 day') ON CONFLICT(key) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`;
      if (Number(volume[0]?.count) > 1000) return { kind: 'limited' };
      await tx`INSERT INTO reports(id, game_id, fields, desktop_submission_key, desktop_submission_hash) VALUES (${id}, ${fields.gameId}, ${tx.json(fields)}, ${key}, ${requestHash})`;
      if (log) await tx`INSERT INTO private_logs(report_id, content) VALUES (${id}, ${Buffer.from(log.text, 'utf8')})`;
      return { kind: 'created', id };
    });
    if (stored.kind === 'conflict') return reply.code(409).send({ error: 'This submission key was already used for a different report. Review your changes and submit with a new key.' });
    if (stored.kind === 'limited') return reply.header('Retry-After', String(86400 - Math.floor(Date.now() / 1000) % 86400)).code(429).send({ error: 'The daily submission limit has been reached. Please try again tomorrow.' });
    if (desktop) return reply.code(stored.kind === 'created' ? 201 : 200).send({ id: stored.id, url: `${config.APP_ORIGIN}/reports/${stored.id}` });
    return reply.code(201).send({ id: stored.id });
  }
  app.post('/api/reports', submitReport);
  app.post(desktopReportPath, { bodyLimit: 128 * 1024 }, submitReport);

  await app.register(async privateApp => {
    privateApp.addHook('onRequest', auth.requireMaintainer);
    privateApp.get('/api/maintainer/reports', async request => {
      const q = querySchema.parse(request.query);
      const [rows, totals] = await Promise.all([
        sql`SELECT ${publicColumns}, r.internal_note, EXISTS(SELECT 1 FROM private_logs l WHERE l.report_id = r.id AND l.expires_at > now()) AS has_log
          FROM reports r JOIN games g ON g.sgdb_id = r.game_id ORDER BY r.created_at DESC, r.id DESC LIMIT 15 OFFSET ${(q.page - 1) * 15}`,
        sql`SELECT count(*)::int AS total FROM reports`,
      ]);
      const total = Number(totals[0]?.total ?? 0);
      return { reports: rows.map(row => maintainerReportSchema.parse({ ...mapReport(row), internalNote: row.internal_note, hasLog: row.has_log })), page: q.page, pageCount: Math.max(1, Math.ceil(total / 15)), total };
    });
    privateApp.patch('/api/maintainer/reports/:id', async (request, reply) => {
      const { id } = uuidParams.parse(request.params);
      const data = triageSchema.parse(request.body);
      const rows = await sql.begin(async tx => {
        const updated = await tx`UPDATE reports SET triage = ${data.triage}, internal_note = ${data.internalNote} WHERE id = ${id} RETURNING id`;
        if (updated.length) await tx`INSERT INTO audit_events(actor, action, report_id) VALUES (${config.GITHUB_ALLOWED_ID ?? ''}, 'triage', ${id})`;
        return updated;
      });
      if (!rows.length) return reply.code(404).send({ error: 'Report not found.' });
      return { ok: true };
    });
    privateApp.get('/api/maintainer/reports/:id/log', async (request, reply) => {
      const { id } = uuidParams.parse(request.params);
      const rows = await sql.begin(async tx => {
        const logs = await tx`SELECT content FROM private_logs WHERE report_id = ${id} AND expires_at > now()`;
        if (logs.length) await tx`INSERT INTO audit_events(actor, action, report_id) VALUES (${config.GITHUB_ALLOWED_ID ?? ''}, 'read-log', ${id})`;
        return logs;
      });
      const log = rows[0]?.content;
      if (!Buffer.isBuffer(log)) return reply.code(404).send({ error: 'This log was not attached, was deleted, or has expired.' });
      return reply.header('Content-Disposition', 'attachment; filename="eden_log.txt"').type('text/plain; charset=utf-8').send(log);
    });
    privateApp.delete('/api/maintainer/reports/:id/log', async (request, reply) => {
      const { id } = uuidParams.parse(request.params);
      await sql.begin(async tx => {
        await tx`DELETE FROM private_logs WHERE report_id = ${id}`;
        await tx`INSERT INTO audit_events(actor, action, report_id) VALUES (${config.GITHUB_ALLOWED_ID ?? ''}, 'delete-log', ${id})`;
      });
      return reply.code(204).send();
    });
  });

  if (serveStatic) {
    const root = fileURLToPath(new URL('../dist', import.meta.url));
    await app.register(staticFiles, { root, wildcard: false, index: false, maxAge: 3600, allowedPath: path => path !== '/index.html' });
    await registerSite(app, sql, config, root);
  }
  return app;
}
