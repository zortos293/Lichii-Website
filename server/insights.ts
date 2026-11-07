import { z } from 'zod';
import { outcomes } from '../shared/domain.ts';
import { derivePlatform, lichiiBuild, medianOutcome, outcomeRank, platforms, setupSummary, tally, type Outcome, type Platform } from '../shared/compat.ts';
import type { Database } from './db.ts';

export type ReportFact = {
  id: string; gameId: number; createdAt: Date; outcome: Outcome; build: number | null; platform: Platform;
  setup: string; gameVersion: string; gpu: string; os: string; buildText: string; title: string; summary: string;
};
export type ReportFilter = { platforms: readonly Platform[]; build: number | 'other' | null; gpu: string; os: string; buildText: string };

const factRow = z.object({
  id: z.uuid(), game_id: z.coerce.number(), created_at: z.date(), outcome: z.enum(outcomes),
  build: z.string(), os: z.string(), cpu: z.string(), gpu: z.string(), graphics_api: z.string(), game_version: z.string(), title: z.string(), summary: z.string(),
});

export async function loadFacts(sql: Database, gameId?: number): Promise<ReportFact[]> {
  const rows = await sql`SELECT r.id, r.game_id, r.created_at, r.fields->>'outcome' AS outcome, r.fields->>'build' AS build, r.fields->>'os' AS os,
    r.fields->>'cpu' AS cpu, r.fields->>'gpu' AS gpu, r.fields->>'graphicsApi' AS graphics_api, r.fields->>'gameVersion' AS game_version,
    r.fields->>'summary' AS summary, g.title FROM reports r JOIN games g ON g.sgdb_id = r.game_id WHERE r.triage <> 'hidden' ${gameId ? sql`AND r.game_id = ${gameId}` : sql``} ORDER BY r.created_at DESC, r.id DESC`;
  return rows.map(row => {
    const r = factRow.parse(row);
    const hardware = { os: r.os, cpu: r.cpu, gpu: r.gpu };
    return {
      id: r.id, gameId: r.game_id, createdAt: r.created_at, outcome: r.outcome, build: lichiiBuild(r.build), platform: derivePlatform(hardware),
      setup: setupSummary({ ...hardware, graphicsApi: r.graphics_api }), gameVersion: r.game_version, gpu: r.gpu, os: r.os, buildText: r.build, title: r.title, summary: r.summary,
    };
  });
}

const contains = (value: string, needle: string) => value.toLowerCase().includes(needle.toLowerCase());
export const hasReportFilter = (filter: ReportFilter) => filter.platforms.length > 0 || filter.build !== null || Boolean(filter.gpu || filter.os || filter.buildText);
export const matchesFilter = (filter: ReportFilter) => (fact: ReportFact) =>
  (!filter.platforms.length || filter.platforms.includes(fact.platform))
  && (filter.build === null || (filter.build === 'other' ? fact.build === null : fact.build === filter.build))
  && contains(fact.gpu, filter.gpu) && contains(fact.os, filter.os) && contains(fact.buildText, filter.buildText);

export function latestBuild(facts: readonly ReportFact[]) {
  return facts.reduce<number | null>((max, fact) => fact.build !== null && (max === null || fact.build > max) ? fact.build : max, null);
}
export function buildColumns(facts: readonly ReportFact[], count = 8) {
  const newest = latestBuild(facts);
  return newest === null ? [] : Array.from({ length: count }, (_, i) => newest - count + 1 + i).filter(build => build > 0);
}

const best = (facts: readonly ReportFact[]) => facts.reduce<ReportFact | undefined>((top, fact) => !top || outcomeRank(fact.outcome) > outcomeRank(top.outcome) ? fact : top, undefined);
const knownVersion = (value: string) => !/^(?:unknown|n\/?a|-*)$/i.test(value.trim());

export function aggregateGame(facts: readonly ReportFact[], columns: readonly number[]) {
  const latest = facts[0];
  const top = best(facts);
  return {
    reportCount: facts.length, status: latest?.outcome ?? 'Untested' as const, latestAt: latest ? latest.createdAt.toISOString() : null,
    median: medianOutcome(facts.map(fact => fact.outcome)), best: top ? { outcome: top.outcome, setup: top.setup } : null,
    latestVersion: facts.find(fact => knownVersion(fact.gameVersion))?.gameVersion.trim() ?? null,
    recentBuilds: columns.map(build => ({ build, status: best(facts.filter(fact => fact.build === build))?.outcome ?? 'Untested' as const })),
  };
}

export function summarize(facts: readonly ReportFact[], scope: readonly ReportFact[] = facts) {
  const outcomesOf = (list: readonly ReportFact[]) => list.map(fact => fact.outcome);
  const byPlatform = [...platforms, 'other' as const].map(platform => ({ platform, ...tally(outcomesOf(facts.filter(fact => fact.platform === platform))) }));
  const groups = new Map<number | null, ReportFact[]>();
  for (const fact of facts) groups.set(fact.build, [...groups.get(fact.build) ?? [], fact]);
  const builds = [...groups].sort(([a], [b]) => a === null ? 1 : b === null ? -1 : b - a).map(([build, list]) => ({
    build, games: new Set(list.map(fact => fact.gameId)).size, latestAt: list[0]?.createdAt.toISOString() ?? '', ...tally(outcomesOf(list)),
  }));
  return {
    latestBuild: latestBuild(scope), gamesTested: new Set(facts.map(fact => fact.gameId)).size, overall: tally(outcomesOf(facts)),
    platforms: byPlatform.filter(entry => entry.platform !== 'other' || entry.total > 0), builds,
  };
}
