import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Link } from './navigation.tsx';
import { ArrowRight, ArrowUpRight, Info } from 'lucide-react';
import { gameSchema, gamesResponseSchema, reportsResponseSchema, statuses, summaryResponseSchema, type Game, type PublicReport, type Summary } from '../shared/domain.ts';
import { buildLabel, derivePlatform, lichiiBuild, outcomeOrder, platformLabels, setupSummary } from '../shared/compat.ts';
import { useApi, useDebounced } from './api.ts';
import { Breadcrumbs, Contribute, Cover, Empty, ErrorNotice, Filters, Loading, Pagination, ReportCard, SearchBox, Status, filterValues, versionLabel, formatDate, relativeTime, type FilterValues } from './components.tsx';
import { BuildStrip, BuildTable, MedianBlock, PlatformBreakdown, PlatformIcon } from './insights.tsx';

export function bestResultText(game: Pick<Game, 'best' | 'reportCount'>) {
  if (!game.best) return 'Not tested yet';
  if (game.best.outcome === 'Unplayable') return 'No working report yet';
  return game.best.setup || 'Setup not given';
}

export function Catalog() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const query = useDebounced(search);
  const actual = new URLSearchParams(params);
  actual.set('q', query);
  const state = useApi(`/api/games?${actual}`, gamesResponseSchema);
  const summary = useApi('/api/summary', summaryResponseSchema);
  const recent = useApi('/api/reports', reportsResponseSchema);
  const builds = summary.kind === 'ready' ? summary.data.builds : null;
  function filter(key: keyof FilterValues | 'q' | 'sort', value: string) { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete('page'); setParams(next, { replace: true }); }
  const columns = state.kind === 'ready' ? state.data.games[0]?.recentBuilds.map(entry => entry.build) ?? [] : [];
  return <>
    <section className="catalog-intro"><div><h1>Will it run?</h1><p>Players test Switch 2 games on Lichii and report what happened, along with their build, game version, CPU, GPU, driver and settings. Search a title, filter by hardware, then read the reports.</p></div><div className="catalog-overview">
      <div className="overview-title"><strong>{state.kind === 'ready' ? `${state.data.totalGames} Switch 2 titles tracked${state.data.latestBuild ? ` · latest build ${state.data.latestBuild}` : ''}` : 'Switch 2 compatibility'}</strong><span className="mono">{state.kind === 'ready' ? `${state.data.totalReports} COMMUNITY REPORTS` : 'COMMUNITY TESTED'}</span></div>
      <svg className="status-track" viewBox="0 0 1000 14" preserveAspectRatio="none" role="img" aria-label={state.kind === 'ready' ? `Latest result per game: ${statuses.map(s => `${state.data.counts[s]} ${s}`).join(', ')}` : 'Loading status counts'}>{statuses.map((status, index) => {
        const total = state.kind === 'ready' ? state.data.totalGames : 0;
        const width = total && state.kind === 'ready' ? state.data.counts[status] / total * 1000 : status === 'Untested' ? 1000 : 0;
        const x = total && state.kind === 'ready' ? statuses.slice(0, index).reduce((sum, key) => sum + state.data.counts[key], 0) / total * 1000 : 0;
        return <rect key={status} className={`track-${status.toLowerCase()}`} x={x} y="0" width={width} height="14" />;
      })}</svg>
      <div className="status-legend">{statuses.map(status => <div key={status}><Status value={status} /><strong>{state.kind === 'ready' ? state.data.counts[status] : '—'}</strong></div>)}</div>
      <p className="fine-print">{state.kind === 'ready' && state.data.totalReports === 0 ? 'A fresh start. Every game is untested until someone submits a report.' : 'Each game counts once, by its latest reported result. Untested means no evidence yet.'}</p>
    </div></section>

    <StatusBand summary={summary} />

    <section className="latest-results-section" aria-labelledby="latest-results">
      <div className="section-heading"><h2 id="latest-results">Latest results</h2><Link to="/reports">All recent reports <ArrowRight size={15} /></Link></div>
      {recent.kind === 'loading' ? <SkeletonRows count={8} /> : recent.kind === 'error' ? <ErrorNotice message={recent.message} /> : recent.data.reports.length === 0
        ? <Empty title="The first report could be yours">No results have been submitted yet. Share a real test to help the next player.<Link className="text-link mt-4" to="/guide">What makes a useful report? <ArrowRight size={14} /></Link></Empty>
        : <ol className="latest-results">{recent.data.reports.slice(0, 8).map(report => <LatestResult key={report.id} report={report} />)}</ol>}
    </section>

    <section id="games" aria-label="Games database" className="games-section"><SearchBox value={search} onChange={value => filter('q', value)} placeholder={state.kind === 'ready' ? `Search ${state.data.totalGames} Switch 2 games or publishers` : 'Search Switch 2 games or publishers'} meta={state.kind === 'ready' ? `${state.data.games.length} of ${state.data.total} shown` : undefined} />
      <div className="filter-bar"><Filters values={filterValues(params)} builds={builds} onChange={filter} /><label className="sort-label">Sort <select aria-label="Sort games" value={params.get('sort') ?? 'popular'} onChange={e => filter('sort', e.target.value)}><option value="popular">Most reported</option><option value="title">Title A–Z</option><option value="recent">Recently tested</option></select></label></div>
      {state.kind === 'loading' ? <SkeletonRows count={6} /> : state.kind === 'error' ? <ErrorNotice message={state.message} /> : <>
        {state.data.games.length === 0 ? <Empty title="No games found">{params.get('platform') || params.get('lichiiBuild') ? 'No reports match these platforms or this build yet. Turn a filter off, or be the first to test it.' : 'Try another title or clear your filters. Untested games have no hardware information yet.'}</Empty> : <div className="table-scroll"><table className="game-table">
          <thead><tr><th>Game · latest version tested</th><th>Status</th><th title={columns.length ? `${buildLabel(columns[0] ?? null)} to ${buildLabel(columns.at(-1) ?? null)}, oldest first` : undefined}>Last 8 builds{columns.length ? ` · ${columns[0]}–${columns.at(-1)}` : ''} →</th><th className="number-col">Reports</th><th>Best result on</th><th>Latest</th><th><span className="sr-only">Contribute</span></th></tr></thead>
          <tbody>{state.data.games.map(game => <tr key={game.sgdbId}>
            <td><Link to={`/games/${game.slug}`} className="game-cell"><Cover game={game} /><div><strong>{game.title}</strong><span>{game.publisher ?? 'Nintendo Switch 2'}{game.latestVersion && <em className="mono">{versionLabel(game.latestVersion)}</em>}</span></div></Link></td>
            <td><Status value={game.status} />{game.median && game.reportCount > 1 && <span className="median-note">median {game.median}</span>}</td>
            <td><BuildStrip builds={game.recentBuilds} /></td>
            <td className="number-col mono">{game.reportCount}</td>
            <td data-label={game.best && game.best.outcome !== 'Unplayable' ? 'Best on' : undefined} className={game.best && game.best.outcome !== 'Unplayable' ? 'best-cell' : 'best-cell muted'}>{bestResultText(game)}</td>
            <td data-label="Latest" className="muted latest-cell">{game.latestAt ? <time dateTime={game.latestAt} title={formatDate(game.latestAt)}>{relativeTime(game.latestAt)}</time> : '—'}</td>
            <td className="row-action"><Link to={`/submit?game=${game.slug}`}>{game.reportCount ? 'Report' : 'Test it'}</Link></td>
          </tr>)}</tbody></table></div>}
        <Pagination page={state.data.page} pageCount={state.data.pageCount} total={state.data.total} onPage={page => { const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next); }} />
      </>}
      <p className="catalog-source"><Info size={14} /><span>Catalog matched to Nintendo’s European Switch 2 listings and SteamGridDB. Coverage may be incomplete. Each build square shows the best result reported on that Lichii build; gray means untested. Cover art is credited on each game page.</span></p>
    </section>

    <section className="bottom-grid"><div><div className="section-heading"><h2>By Lichii build</h2><span className="section-note">Reports grouped by the build players typed in</span></div>
      {summary.kind === 'loading' ? <Loading /> : summary.kind === 'error' ? <ErrorNotice message={summary.message} /> : summary.data.builds.length
        ? <BuildTable builds={summary.data.builds} caption="Results by Lichii build" linkFor={build => `/reports?lichiiBuild=${build ?? 'other'}`} />
        : <Empty title="No builds reported yet">Build sections appear as soon as the first report names its Lichii build.</Empty>}
    </div><Contribute /></section>
  </>;
}

function StatusBand({ summary }: { summary: ReturnType<typeof useApi<Summary>> }) {
  if (summary.kind === 'error') return <ErrorNotice message={summary.message} />;
  return <section className="status-band" aria-labelledby="community-status" aria-busy={summary.kind === 'loading'}>
    <h2 id="community-status" className="sr-only">Community status</h2>
    {summary.kind === 'loading' ? <><div className="skeleton skeleton-block" /><div className="skeleton skeleton-block" /></> : <>
      <div><MedianBlock tally={summary.data.overall} scope={`all ${summary.data.overall.total} reports`} />
        <dl className="band-stats"><div><dt>Reports</dt><dd>{summary.data.overall.total}</dd></div><div><dt>Games tested</dt><dd>{summary.data.gamesTested}</dd></div><div><dt>Latest build</dt><dd>{summary.data.latestBuild ?? '—'}</dd></div></dl>
      </div>
      <div><div className="band-heading"><h3>Playable by platform</h3><span>Share of reports rated Playable or Perfect</span></div>
        <PlatformBreakdown entries={summary.data.platforms} linkFor={platform => `/reports?platform=${platform}`} />
        <p className="fine-print">Platform comes from the OS, CPU and GPU each player typed in. Steam Deck includes SteamOS reports without a desktop GPU.</p>
      </div>
    </>}
  </section>;
}

function LatestResult({ report }: { report: PublicReport }) {
  const platform = derivePlatform(report);
  const build = lichiiBuild(report.build);
  return <li className={`result-row tone-${report.outcome.toLowerCase()}`}><Link to={`/reports/${report.id}`}>
    <Cover game={{ title: report.gameTitle, coverPath: report.gameCoverPath }} />
    <span className="result-main"><strong>{report.gameTitle}</strong><span>{report.summary}</span></span>
    <Status value={report.outcome} chip />
    <span className="result-build mono">{buildLabel(build)}</span>
    <span className="result-setup"><PlatformIcon platform={platform} /><span><span className="sr-only">{platformLabels[platform]}: </span>{setupSummary(report) || platformLabels[platform]}</span></span>
    <time dateTime={report.createdAt} title={formatDate(report.createdAt)}>{relativeTime(report.createdAt)}</time>
  </Link></li>;
}

export function SkeletonRows({ count }: { count: number }) {
  return <div role="status" aria-label="Loading" className="skeleton-rows">{Array.from({ length: count }, (_, i) => <div key={i} className="skeleton skeleton-row" />)}</div>;
}

export function GameDetail() {
  const { slug } = useParams();
  const state = useApi(`/api/games/${encodeURIComponent(slug ?? '')}`, gameSchema);
  const [page, setPage] = useState(1);
  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <ErrorNotice message={state.message} />;
  const game = state.data;
  return <><Breadcrumbs items={[{ label: game.title }]} /><section className={`game-hero ${game.heroPath ? 'has-hero' : ''}`}>
    {game.heroPath && <img className="hero-art" src={game.heroPath} alt="" />}<div className="hero-shade" /><div className="hero-content"><Cover game={game} large /><div><span className="platform-pill">Nintendo Switch 2</span><h1>{game.title}</h1></div></div>
    <a className="hero-credit" href={game.artworkSource ?? `https://www.steamgriddb.com/game/${game.sgdbId}`} target="_blank" rel="noreferrer">Art: SteamGridDB community <ArrowUpRight size={13} /></a>
  </section><div className="detail-grid"><div><GameInsights game={game} />
    <section className="report-section"><div className="section-heading"><h2>Community reports <span className="muted">{game.reportCount}</span></h2><Link to={`/submit?game=${game.slug}`}>Submit yours <ArrowRight size={14} /></Link></div><GameReports id={game.sgdbId} page={page} onPage={setPage} /></section>
  </div><div className="detail-sidebar"><Contribute game={game} /><section><h3 className="lined-heading">About the game</h3><dl className="facts"><div><dt>Platform</dt><dd>Nintendo Switch 2</dd></div><div><dt>Publisher</dt><dd>{game.publisher ?? 'Not recorded'}</dd></div><div><dt>Latest version tested</dt><dd>{game.latestVersion ? versionLabel(game.latestVersion) : 'Not tested'}</dd></div><div><dt>Catalog source</dt><dd><a href={`https://www.steamgriddb.com/game/${game.sgdbId}`} target="_blank" rel="noreferrer">SteamGridDB <ArrowUpRight size={13} /></a></dd></div></dl></section><section><h3 className="lined-heading">Art credits</h3><p className="muted text-sm leading-6">{game.artworkCredit ?? 'No artwork has been added for this title yet.'}</p>{game.artworkSource && <a className="text-link mt-3" href={game.artworkSource} target="_blank" rel="noreferrer">Original artwork <ArrowUpRight size={14} /></a>}</section><div className="notice"><Info size={19} /><p>Untested doesn’t mean unplayable. It means we don’t have evidence yet.</p></div></div></div></>;
}

function GameInsights({ game }: { game: Game }) {
  const summary = useApi(`/api/summary?gameId=${game.sgdbId}`, summaryResponseSchema);
  const perBuild = summary.kind === 'ready' ? new Map(summary.data.builds.map(entry => [entry.build, entry])) : new Map<number | null, Summary['builds'][number]>();
  return <>
    <section className="game-summary"><div><span className="eyebrow">{game.reportCount ? 'Latest community result' : 'Current status'}</span><Status value={game.status} large />
      <p className="muted">{game.reportCount ? `Latest of ${game.reportCount} ${game.reportCount === 1 ? 'report' : 'reports'}${game.median && game.reportCount > 1 ? `. Median result: ${game.median}.` : '.'} Read individual reports before drawing conclusions.` : 'Nobody has reported a test yet. We don’t know how this game runs on Lichii.'}</p></div>
      <div className="build-chart"><div className="build-chart-head"><strong>Reports per build, last {game.recentBuilds.length || 8} builds</strong><span className="mono">1 square = 1 report</span></div>
        {game.recentBuilds.length ? <div className="build-chart-columns" role="img" aria-label={game.recentBuilds.map(entry => `build ${entry.build}: ${perBuild.get(entry.build)?.total ?? 0} reports`).join(', ')}>
          {game.recentBuilds.map(entry => { const tally = perBuild.get(entry.build); const shown = Math.min(tally?.total ?? 0, 8); let left = shown; return <div key={entry.build} className="build-chart-column">
            <div className="build-chart-stack">{outcomeOrder.flatMap(outcome => { const take = Math.min(tally?.counts[outcome] ?? 0, left); left -= take; return Array.from({ length: take }, (_, i) => <span key={`${outcome}${i}`} className={`status-${outcome.toLowerCase()}`} />); })}{(tally?.total ?? 0) > 8 && <em>+{(tally?.total ?? 0) - 8}</em>}</div>
            <span className="mono">{entry.build}</span></div>; })}
        </div> : <p className="muted">Builds appear with the first report that names one.</p>}
      </div></section>
    <div className="detail-stats"><div><strong>{game.reportCount}</strong><span>public reports</span></div><div><strong>{game.latestAt ? relativeTime(game.latestAt) : 'Not tested'}</strong><span>latest report</span></div><div><strong>{bestResultText(game)}</strong><span>{game.best && game.best.outcome !== 'Unplayable' ? `best result · ${game.best.outcome}` : 'best result'}</span></div></div>
    {game.reportCount > 0 && summary.kind === 'ready' && <div className="game-breakdowns">
      <section><div className="section-heading"><h2>By platform</h2><span className="section-note">Playable or Perfect, per platform</span></div><PlatformBreakdown entries={summary.data.platforms} /></section>
      <section><div className="section-heading"><h2>By build</h2><span className="section-note">Every report for this game, grouped by Lichii build</span></div><BuildTable builds={summary.data.builds} caption={`${game.title} results by Lichii build`} linkFor={build => `/reports?lichiiBuild=${build ?? 'other'}&gameId=${game.sgdbId}`} /></section>
    </div>}
  </>;
}

function GameReports({ id, page, onPage }: { id: number; page: number; onPage: (page: number) => void }) {
  const state = useApi(`/api/reports?gameId=${id}&page=${page}`, reportsResponseSchema);
  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <ErrorNotice message={state.message} />;
  return state.data.reports.length ? <>{state.data.reports.map(r => <ReportCard key={r.id} report={r} showGame={false} />)}<Pagination {...state.data} onPage={onPage} /></> : <Empty title="No reports for this game yet">Test it on your setup and tell other players what happened. Good news or a crash, both are useful.</Empty>;
}
