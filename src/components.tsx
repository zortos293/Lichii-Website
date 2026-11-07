import { ArrowRight, ChevronLeft, ChevronRight, FileText, Gamepad2, LockKeyhole, Search, ShieldCheck } from 'lucide-react';
import { buildLabel, derivePlatform, lichiiBuild, platformLabels, setupSummary } from '../shared/compat.ts';
import type { Summary } from '../shared/domain.ts';
import { BuildSelect, PlatformIcon, PlatformToggles } from './insights.tsx';
import { useLocation } from 'react-router-dom';
import { Link, NavLink } from './navigation.tsx';
import { useEffect, useRef, type ReactNode } from 'react';
import { statuses, type Game, type PublicReport } from '../shared/domain.ts';

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  return <><a className="skip-link" href="#main">Skip to content</a><header className="site-header"><div className="header-inner">
    <Link to="/" className="brand" aria-label="Lichii compatibility home"><img src="/branding/lockup.png" width="122" height="56" alt="Lichii" /><span>compat · Switch 2</span></Link>
    <nav aria-label="Main navigation"><NavLink to="/" end>Games</NavLink><NavLink to="/reports">Recent reports</NavLink><NavLink to="/guide">How to report</NavLink></nav>
    <Link to="/submit" className="button primary header-cta">Submit a report</Link>
  </div></header><main id="main" className="page">{children}</main><footer className="site-footer"><p>Lichii is an independent, experimental emulator, not affiliated with Nintendo.</p><div><Link to="/privacy">Privacy & safety</Link><Link to="/maintainer"><ShieldCheck size={14} /> Maintainer</Link></div></footer></>;
}
export function Status({ value, large = false, chip = false }: { value: Game['status']; large?: boolean; chip?: boolean }) {
  return <span className={`status status-${value.toLowerCase()} ${large ? 'status-large' : ''} ${chip ? 'status-chip' : ''}`}><i aria-hidden="true" />{value}</span>;
}
export function Cover({ game, large = false }: { game: { title: string; coverPath: string | null }; large?: boolean }) {
  return game.coverPath ? <img className={`cover ${large ? 'cover-large' : ''}`} src={game.coverPath} alt={`${game.title} cover`} loading={large ? 'eager' : 'lazy'} /> : <div className={`cover cover-missing ${large ? 'cover-large' : ''}`} aria-label="Cover art unavailable"><Gamepad2 size={large ? 40 : 22} /></div>;
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><FileText size={25} strokeWidth={1.4} /></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Loading() { return <div role="status" className="loading"><span className="loading-dot" />Loading…</div>; }
export function ErrorNotice({ message }: { message: string }) { return <div role="alert" className="notice error"><strong>We couldn’t load that.</strong><p>{message}</p><button className="text-link" onClick={() => window.location.reload()}>Try again</button></div>; }
export function Pagination({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (page: number) => void }) {
  const pages = [...new Set([1, page - 1, page, page + 1, pageCount])].filter(value => value >= 1 && value <= pageCount).sort((a, b) => a - b);
  return <nav className="pagination" aria-label="Pagination"><span>{total === 0 ? 'No results' : `Showing ${(page - 1) * 15 + 1}–${Math.min(page * 15, total)} of ${total}`}</span>{pageCount > 1 && <div>
    <button className="page-button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
    {pages.map((value, index) => <span key={value} className="contents">{index > 0 && value - (pages[index - 1] ?? value) > 1 && <span className="page-gap" aria-hidden="true">…</span>}<button className="page-button" aria-current={value === page ? 'page' : undefined} aria-label={`Page ${value}`} onClick={() => onPage(value)}>{value}</button></span>)}
    <button className="page-button page-next" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">Next <ChevronRight size={15} /></button>
  </div>}</nav>;
}
export function SearchBox({ value, onChange, placeholder, meta }: { value: string; onChange: (value: string) => void; placeholder: string; meta?: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', focus);
    return () => window.removeEventListener('keydown', focus);
  }, []);
  return <label className="search-box"><Search size={23} strokeWidth={1.6} /><input ref={input} type="search" aria-label={placeholder} aria-keyshortcuts="/" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={150} />{meta && <span className="search-meta" aria-live="polite">{meta}</span>}<kbd aria-hidden="true">/</kbd></label>;
}
export type FilterValues = { status: string; gpu: string; platform: string; lichiiBuild: string };
export function filterValues(params: URLSearchParams): FilterValues {
  return { status: params.get('status') ?? 'Any', gpu: params.get('gpu') ?? '', platform: params.get('platform') ?? '', lichiiBuild: params.get('lichiiBuild') ?? '' };
}
export function Filters({ values, builds, onChange }: { values: FilterValues; builds: Summary['builds'] | null; onChange: (key: keyof FilterValues, value: string) => void }) {
  return <div className="filter-group">
    <PlatformToggles selected={values.platform ? values.platform.split(',') : []} onChange={next => onChange('platform', next.join(','))} />
    <label>Status <select aria-label="Filter by status" value={values.status} onChange={e => onChange('status', e.target.value)}><option value="Any">Any</option>{statuses.map(s => <option key={s}>{s}</option>)}</select></label>
    <label>GPU <select aria-label="Filter by GPU" value={values.gpu} onChange={e => onChange('gpu', e.target.value)}><option value="">Any vendor</option><option>NVIDIA</option><option>AMD</option><option>Intel</option><option>Apple</option></select></label>
    <BuildSelect builds={builds} value={values.lichiiBuild} onChange={value => onChange('lichiiBuild', value)} />
  </div>;
}
export const versionLabel = (version: string) => /^v?\d/i.test(version) ? `v${version.replace(/^v/i, '')}` : version;
export const buildTag = (build: string) => { const number = lichiiBuild(build); return number === null ? build.slice(0, 40) : buildLabel(number); };
export function ReportCard({ report, showGame = true }: { report: PublicReport; showGame?: boolean }) {
  const platform = derivePlatform(report);
  return <article className={`report-card ${showGame ? 'with-cover' : ''}`}>
    {showGame && <Link to={`/games/${report.gameSlug}`} className="report-cover" tabIndex={-1} aria-hidden="true"><Cover game={{ title: report.gameTitle, coverPath: report.gameCoverPath }} /></Link>}
    <div className="report-main">
      {showGame && <Link to={`/games/${report.gameSlug}`} className="report-game-title">{report.gameTitle}</Link>}
      <div className="report-heading"><Status value={report.outcome} chip /><Link to={`/reports/${report.id}`} className="report-title">{report.summary}</Link></div>
      <p className="report-excerpt">{report.details}</p>
      <div className="tags"><span>{buildTag(report.build)}</span><span>{versionLabel(report.gameVersion)}</span><span className="tag-platform"><PlatformIcon platform={platform} size={11} />{platformLabels[platform]}</span><span>{setupSummary(report) || report.gpu}</span></div>
    </div>
    <div className="report-meta"><strong>{report.name}</strong>{report.handle && <span>@{report.handle.replace(/^@/, '')}</span>}<time dateTime={report.createdAt} title={formatDate(report.createdAt)}>{relativeTime(report.createdAt)}</time><Link className="report-open" to={`/reports/${report.id}`}>Open <ArrowRight size={14} /></Link></div>
  </article>;
}
export function Contribute({ game }: { game?: Game }) {
  return <aside className="contribute panel"><h2>{game ? `Played ${game.title} on Lichii?` : 'Played a Switch 2 game on Lichii? Tell people how it ran.'}</h2><p className="muted">A useful report starts with what you actually tested.</p><div className="contribute-steps"><div><strong>eden_log.txt</strong><span>Private to the maintainer</span></div><div><strong>Build and hardware</strong><span>Read from the log, you check</span></div><div><strong>Outcome</strong><span>You pick it</span></div><div><strong>What happened</strong><span>You write it</span></div></div><Link className="button primary" to={game ? `/submit?game=${game.slug}` : '/submit'}>Submit a report</Link><Link className="button" to="/guide">How to report <ArrowRight size={15} /></Link><p className="fine-print">No account needed, just a name. Never upload game files, keys, firmware, saves or personal information.</p></aside>;
}
export function PrivateNote() { return <span className="private-note"><LockKeyhole size={14} /> Log files are never public</span>; }
export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return <nav aria-label="Breadcrumb" className="breadcrumbs"><Link to="/">Games</Link>{items.map((item, i) => <span key={i}>/ {item.to ? <Link to={item.to}>{item.label}</Link> : <strong>{item.label}</strong>}</span>)}</nav>;
}
export function formatDate(value: string) { return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
export function relativeTime(value: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  if (minutes < 43200) return `${Math.round(minutes / 1440)} d ago`;
  return formatDate(value);
}
