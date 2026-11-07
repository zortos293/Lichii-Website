import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Download, Github, Link2, LockKeyhole, LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { maintainerReportSchema, maintainerResponseSchema, summaryResponseSchema, triageStates, type MaintainerReport, type TriageState } from '../shared/domain.ts';
import { derivePlatform, setupSummary } from '../shared/compat.ts';
import { extractLogFields } from '../shared/log.ts';
import { api, useApi, useDebounced } from './api.ts';
import { Cover, Empty, ErrorNotice, Filters, Loading, Pagination, SearchBox, Status, buildTag, filterValues, formatDate, relativeTime, versionLabel } from './components.tsx';
import { PlatformIcon } from './insights.tsx';
import { Link } from './navigation.tsx';
import { ReportSetup } from './reports.tsx';

const statusSchema = z.object({ configured: z.boolean(), authenticated: z.boolean() });
const okSchema = z.object({ ok: z.boolean() });
const triageLabels: Record<TriageState, string> = { new: 'New', reviewed: 'Reviewed', 'needs-info': 'Needs info', hidden: 'Hidden' };
const queueKeys = ['q', 'triage', 'status', 'gpu', 'platform', 'lichiiBuild', 'log', 'page'] as const;
const typing = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable]'));
const plainKey = (event: KeyboardEvent) => !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target);

export function Maintainer() {
  const state = useApi('/api/auth/status', statusSchema);
  const [params] = useSearchParams();
  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <ErrorNotice message={state.message} />;
  if (!state.data.authenticated) return <div className="login-page"><div className="login-icon"><ShieldCheck size={34} strokeWidth={1.5} /></div><h1 className="page-title">Maintainer access</h1><p>Private logs and triage are restricted to the authorized Lichii maintainer.</p><div className="panel"><Github size={28} /><h2>Sign in with GitHub</h2><p>Only <strong>zortos293</strong>, verified by account ID, can access this area. No community accounts are needed to submit reports.</p>{params.has('error') && <div className="notice error" role="alert">{params.get('error') === 'not-allowed' ? 'This GitHub account is not authorized.' : 'Sign-in could not be completed. Please try again.'}</div>}{state.data.configured ? <a className="button primary" href="/api/auth/login"><Github size={18} /> Continue with GitHub <ArrowRight size={16} /></a> : <div className="notice"><LockKeyhole size={19} /><p>Maintainer sign-in is not configured yet. Private data remains locked.</p></div>}</div><Link className="text-link" to="/">Back to the games database <ArrowRight size={15} /></Link></div>;
  return <MaintainerArea />;
}

function MaintainerArea() {
  const [params, setParams] = useSearchParams();
  const [revision, setRevision] = useState(0);
  const debounced = useDebounced(params.get('q') ?? '');
  const query = new URLSearchParams();
  for (const key of queueKeys) { const value = key === 'q' ? debounced : params.get(key); if (value) query.set(key, value); }
  query.set('revision', String(revision));
  const queue = useApi(`/api/maintainer/reports?${query}`, maintainerResponseSchema);
  const reportId = params.get('report');
  const queueLink = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    return `/maintainer?${next}`;
  };
  const update = (changes: Record<string, string | null>) => setParams(new URL(queueLink(changes), window.location.origin).searchParams, { replace: true });
  async function logout() { await api('/api/auth/logout', okSchema, { method: 'POST', body: '{}' }); window.location.assign('/maintainer'); }
  const counts = queue.kind === 'ready' ? queue.data.counts : null;
  return <>
    <div className="maintainer-bar"><ShieldCheck size={16} /><strong>Maintainer view</strong><span>Private. Reporters and visitors never see this page.</span>
      <div className="maintainer-bar-end">{counts && <span>Triage queue · {counts.new} new</span>}<button type="button" className="text-link" onClick={() => { void logout(); }}><LogOut size={15} /> Sign out</button></div>
    </div>
    {reportId
      ? <ReportDetail key={reportId} id={reportId} queue={queue.kind === 'ready' ? queue.data.reports : []} queueLink={queueLink} onChanged={() => setRevision(value => value + 1)} />
      : <Queue params={params} state={queue} update={update} queueLink={queueLink} />}
  </>;
}

type QueueState = ReturnType<typeof useApi<z.infer<typeof maintainerResponseSchema>>>;
function Queue({ params, state, update, queueLink }: { params: URLSearchParams; state: QueueState; update: (changes: Record<string, string | null>) => void; queueLink: (changes: Record<string, string | null>) => string }) {
  const summary = useApi('/api/summary', summaryResponseSchema);
  const navigate = useNavigate();
  const body = useRef<HTMLTableSectionElement>(null);
  const triage = params.get('triage') ?? 'any';
  useEffect(() => {
    const move = (event: KeyboardEvent) => {
      if (!plainKey(event) || (event.key !== 'j' && event.key !== 'k')) return;
      const links = [...body.current?.querySelectorAll<HTMLAnchorElement>('a.queue-open') ?? []];
      if (!links.length) return;
      event.preventDefault();
      const current = links.findIndex(link => link === document.activeElement);
      const next = current === -1 ? 0 : Math.min(links.length - 1, Math.max(0, current + (event.key === 'j' ? 1 : -1)));
      links[next]?.focus();
    };
    window.addEventListener('keydown', move);
    return () => window.removeEventListener('keydown', move);
  }, []);
  const counts = state.kind === 'ready' ? state.data.counts : null;
  const filtered = queueKeys.some(key => key !== 'page' && params.get(key));
  return <>
    <div className="page-heading"><div><h1 className="page-title">Report triage</h1><p className="page-description">Every report, newest first, hidden ones included. Logs and notes stay private.</p></div>
      {counts && <dl className="heading-stats"><div><dt>new</dt><dd>{counts.new}</dd></div><div><dt>need info</dt><dd>{counts['needs-info']}</dd></div><div><dt>hidden</dt><dd>{counts.hidden}</dd></div></dl>}
    </div>
    <div className="triage-tabs" role="group" aria-label="Filter by triage state">
      {(['any', ...triageStates] as const).map(state => <button key={state} type="button" aria-pressed={triage === state} onClick={() => update({ triage: state === 'any' ? null : state, page: null })}>
        {state === 'any' ? 'All' : triageLabels[state]}<span>{counts ? state === 'any' ? Object.values(counts).reduce((sum, value) => sum + value, 0) : counts[state] : '–'}</span>
      </button>)}
    </div>
    <SearchBox value={params.get('q') ?? ''} onChange={value => update({ q: value, page: null })} placeholder="Search reports, games, reporters or IDs" />
    <div className="filter-bar">
      <div className="filter-group">
        <Filters values={filterValues(params)} builds={summary.kind === 'ready' ? summary.data.builds : null} onChange={(key, value) => update({ [key]: value === 'Any' ? null : value, page: null })} />
        <label>Log <select aria-label="Filter by private log" value={params.get('log') ?? ''} onChange={event => update({ log: event.target.value, page: null })}><option value="">Any</option><option value="attached">Attached</option><option value="none">None</option></select></label>
      </div>
      <span className="sort-label">Sort <strong>Newest</strong></span>
    </div>
    {state.kind === 'loading' ? <Loading /> : state.kind === 'error' ? <ErrorNotice message={state.message} /> : state.data.reports.length === 0
      ? <Empty title={filtered ? 'No reports match' : 'The queue is clear'}>{filtered ? 'Turn a filter off or try a broader search.' : 'There are no reports to review yet.'}</Empty>
      : <><div className="table-scroll"><table className="queue-table">
        <caption className="sr-only">Reports in the maintainer queue</caption>
        <thead><tr><th>Report</th><th>Status</th><th>Triage</th><th>Build</th><th>Setup</th><th>Log</th><th>Received</th></tr></thead>
        <tbody ref={body}>{state.data.reports.map(report => {
          const to = queueLink({ report: report.id, line: null });
          return <tr key={report.id} className={report.triage === 'hidden' ? 'is-hidden' : undefined} onClick={event => { if (!(event.target as HTMLElement).closest('a, button')) void navigate(to); }}>
            <td><div className="queue-report"><Cover game={{ title: report.gameTitle, coverPath: report.gameCoverPath }} /><div><Link className="queue-open" to={to}>{report.summary}</Link><span>{report.gameTitle} · {report.name}</span></div></div></td>
            <td data-label="Status"><Status value={report.outcome} /></td>
            <td><TriageBadge value={report.triage} /></td>
            <td className="mono queue-build">{buildTag(report.build)}</td>
            <td><span className="queue-setup"><PlatformIcon platform={derivePlatform(report)} size={13} />{setupSummary(report) || report.gpu}</span></td>
            <td>{report.hasLog ? <span className="queue-log"><LockKeyhole size={13} aria-hidden="true" />Log</span> : <span className="muted" aria-label="No log">—</span>}</td>
            <td className="queue-time"><time dateTime={report.createdAt} title={formatDate(report.createdAt)}>{relativeTime(report.createdAt)}</time></td>
          </tr>;
        })}</tbody>
      </table></div>
      <Pagination {...state.data} onPage={page => update({ page: String(page) })} /></>}
    <p className="shortcut-legend"><span><kbd>/</kbd> search</span><span><kbd>j</kbd><kbd>k</kbd> move</span><span><kbd>Enter</kbd> open</span></p>
  </>;
}

function TriageBadge({ value }: { value: TriageState }) {
  return <span className={`triage-pill triage-${value}`}>{triageLabels[value]}</span>;
}

function ReportDetail({ id, queue, queueLink, onChanged }: { id: string; queue: MaintainerReport[]; queueLink: (changes: Record<string, string | null>) => string; onChanged: () => void }) {
  const state = useApi(`/api/maintainer/reports/${encodeURIComponent(id)}`, maintainerReportSchema);
  useEffect(() => { window.scrollTo(0, 0); }, [id]);
  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <><ErrorNotice message={state.message} /><Link className="text-link" to={queueLink({ report: null, line: null })}><ArrowLeft size={15} /> Back to the queue</Link></>;
  const index = queue.findIndex(report => report.id === id);
  return <ReportView initial={state.data} previous={index > 0 ? queue[index - 1]?.id : undefined} next={index >= 0 ? queue[index + 1]?.id : undefined} queueLink={queueLink} onChanged={onChanged} />;
}

function ReportView({ initial, previous, next, queueLink, onChanged }: { initial: MaintainerReport; previous?: string; next?: string; queueLink: (changes: Record<string, string | null>) => string; onChanged: () => void }) {
  const [report, setReport] = useState(initial);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const close = queueLink({ report: null, line: null });
  const neighbor = (target?: string) => target ? queueLink({ report: target, line: null }) : undefined;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && typing(event.target)) { (event.target as HTMLElement).blur(); return; }
      if (!plainKey(event)) return;
      const target = event.key === 'Escape' ? close : event.key === '[' ? neighbor(previous) : event.key === ']' ? neighbor(next) : undefined;
      if (!target) return;
      event.preventDefault();
      void navigate(target);
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });
  const line = Number(params.get('line')) || null;
  const selectLine = (value: number) => { const nextParams = new URLSearchParams(params); nextParams.set('line', String(value)); setParams(nextParams, { replace: true }); };
  const handle = report.handle.replace(/^@/, '');
  const previousLink = neighbor(previous);
  const nextLink = neighbor(next);
  return <>
    <nav className="detail-toolbar" aria-label="Report navigation">
      <Link to={close} className="text-link"><ArrowLeft size={15} /> Queue <kbd>Esc</kbd></Link>
      <div>
        {previousLink ? <Link to={previousLink} className="page-button" aria-label="Previous report"><ChevronLeft size={15} /></Link> : <span className="page-button" aria-hidden="true"><ChevronLeft size={15} /></span>}
        {nextLink ? <Link to={nextLink} className="page-button" aria-label="Next report"><ChevronRight size={15} /></Link> : <span className="page-button" aria-hidden="true"><ChevronRight size={15} /></span>}
        <span className="shortcut-legend"><kbd>[</kbd><kbd>]</kbd></span>
      </div>
    </nav>
    <header className="maintainer-report-head">
      <Cover game={{ title: report.gameTitle, coverPath: report.gameCoverPath }} />
      <div className="maintainer-report-title">
        <div className="maintainer-report-meta"><span className="mono">#{report.id.slice(0, 8)}</span><Status value={report.outcome} /><TriageBadge value={report.triage} /><span>{[report.gameTitle, buildTag(report.build), versionLabel(report.gameVersion), setupSummary(report)].filter(Boolean).join(' · ')}</span></div>
        <h1>{report.summary}</h1>
      </div>
      <div className="maintainer-report-from"><span>From <strong>{report.name}</strong> · <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time></span>{handle && <a className="button compact" href={`https://x.com/${handle}`} target="_blank" rel="noreferrer">@{handle} on X</a>}</div>
    </header>
    <div className="detail-grid maintainer-detail">
      <div className="maintainer-main">
        {report.hasLog ? <LogViewer report={report} line={line} onSelectLine={selectLine} /> : <div className="log-card log-card-empty"><LockKeyhole size={18} /><div><strong>No private log</strong><p>No log was attached, or it was deleted or expired. Ask the reporter for eden_log.txt if you need one.</p></div></div>}
        <article className="report-body">
          <section><h2 className="lined-heading">Reporter’s description</h2><p className="preserve-lines">{report.details}</p></section>
          <section><h2 className="lined-heading">How far they got</h2><p className="preserve-lines">{report.progress}</p></section>
          <section><h2 className="lined-heading">Reproduction steps</h2><p className="preserve-lines">{report.reproduction || 'Not supplied.'}</p></section>
          <section><h2 className="lined-heading">Settings</h2><p className="preserve-lines">{report.settings}</p></section>
        </article>
      </div>
      <aside className="detail-sidebar">
        <TriagePanel key={`${report.triage}-${report.internalNote}`} report={report} onSaved={saved => { setReport(current => ({ ...current, ...saved })); onChanged(); }} />
        {report.logExpiresAt && <RetentionPanel id={report.id} expiresAt={report.logExpiresAt} onDeleted={() => { setReport(current => ({ ...current, hasLog: false, logExpiresAt: null })); onChanged(); }} />}
        <ReportSetup report={report} />
        {report.triage !== 'hidden' && <Link className="text-link" to={`/reports/${report.id}`}>Open the public report <ArrowRight size={15} /></Link>}
      </aside>
    </div>
  </>;
}

function TriagePanel({ report, onSaved }: { report: MaintainerReport; onSaved: (saved: Pick<MaintainerReport, 'triage' | 'internalNote'>) => void }) {
  const [triage, setTriage] = useState(report.triage);
  const [note, setNote] = useState(report.internalNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = triage !== report.triage || note.trim() !== report.internalNote;
  async function save() {
    if (busy || !dirty) return;
    setBusy(true); setError('');
    try {
      await api(`/api/maintainer/reports/${report.id}`, okSchema, { method: 'PATCH', body: JSON.stringify({ triage, internalNote: note }) });
      onSaved({ triage, internalNote: note.trim() });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save.'); setBusy(false); }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void saveRef.current(); return; }
      const state = plainKey(event) ? triageStates[Number(event.key) - 1] : undefined;
      if (!state) return;
      event.preventDefault();
      setTriage(state);
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);
  return <section className="triage-panel" aria-labelledby="triage-heading">
    <div className="lined-heading triage-heading"><h2 id="triage-heading">Triage</h2><TriageBadge value={report.triage} /></div>
    <div className="triage-states" role="radiogroup" aria-label="Triage state">
      {triageStates.map((state, index) => <button key={state} type="button" role="radio" aria-checked={triage === state} className={`triage-${state}`} onClick={() => setTriage(state)}>{triageLabels[state]}<kbd>{index + 1}</kbd></button>)}
    </div>
    {triage === 'hidden' && <p className="field-hint">Hidden reports leave every public page and aggregate until you choose another state.</p>}
    <label className="field"><span>Internal note</span><textarea rows={5} value={note} onChange={event => setNote(event.target.value)} maxLength={6000} placeholder="Only you can read this note." /></label>
    <div className="triage-save"><button type="button" className="button primary" disabled={busy || !dirty} onClick={() => { void save(); }}>{busy ? 'Saving…' : 'Save triage'}</button><span className="shortcut-legend"><kbd>Ctrl</kbd><kbd>Enter</kbd></span><span className="field-hint" role="status">{dirty ? 'Unsaved changes' : ''}</span></div>
    {error && <p className="field-error" role="alert">{error}</p>}
  </section>;
}

function RetentionPanel({ id, expiresAt, onDeleted }: { id: string; expiresAt: string; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/maintainer/reports/${id}/log`, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('Could not delete the log. Please check your session.');
      onDeleted();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not delete.'); setBusy(false); }
  }
  return <div className="panel retention-panel"><h3>Log retention</h3><p>Kept until {formatDate(expiresAt)}, then deleted automatically. The public report stays.</p>
    {confirm ? <div className="retention-confirm"><button type="button" className="button danger" disabled={busy} onClick={() => { void remove(); }}>Delete permanently</button><button type="button" className="button" onClick={() => setConfirm(false)}>Cancel</button></div>
      : <button type="button" className="text-link danger-link" onClick={() => setConfirm(true)}><Trash2 size={15} /> Delete log now</button>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}

type LogLine = { number: number; text: string; time: string; module: string; level: string; source: string; message: string };
const logLevels = ['Critical', 'Error', 'Warning', 'Info', 'Debug', 'Trace'] as const;
function parseLog(text: string): LogLine[] {
  const rows = text.split(/\r?\n/);
  if (rows.at(-1) === '') rows.pop();
  return rows.map((row, index) => {
    const match = /^\[\s*([\d.]+)\]\s+(\S+)\s+<(\w+)>\s?(.*)$/.exec(row);
    const body = match?.[4] ?? row;
    const located = match ? /^(\S+?:\d+:[^:\s]+): (.*)$/.exec(body) : null;
    return { number: index + 1, text: row, time: match?.[1] ?? '', module: match?.[2] ?? '', level: match?.[3] ?? '', source: located?.[1] ?? '', message: located?.[2] ?? body };
  });
}
function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function LogViewer({ report, line, onSelectLine }: { report: MaintainerReport; line: number | null; onSelectLine: (line: number) => void }) {
  const [log, setLog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [level, setLevel] = useState('All');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => log === null ? [] : parseLog(log), [log]);
  const levelCounts = useMemo(() => Object.fromEntries(logLevels.map(name => [name, lines.filter(entry => entry.level === name).length])), [lines]);
  const visible = useMemo(() => lines.filter(entry => (level === 'All' || entry.level === level) && (!query || entry.text.toLowerCase().includes(query.toLowerCase()))), [lines, level, query]);
  const firstProblem = lines.find(entry => entry.level === 'Critical') ?? lines.find(entry => entry.level === 'Error');
  const jumps = ([
    ['System info', lines.find(entry => entry.source.endsWith(':LogSystemInfo'))],
    ['Config', lines.find(entry => entry.source.endsWith(':LogSettings'))],
    ['Booting game', lines.find(entry => entry.message.startsWith('Booting game'))],
    [firstProblem?.level === 'Critical' ? 'First critical' : 'First error', firstProblem],
  ] satisfies [string, LogLine | undefined][]).flatMap(([label, target]) => target ? [{ label, target }] : []);

  async function open() {
    if (busy || log !== null) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/maintainer/reports/${report.id}/log`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('The log could not be opened. Your session may have expired, or the log is no longer available.');
      setLog(await response.text());
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not read the log.'); }
    finally { setBusy(false); }
  }
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!plainKey(event)) return;
      if (event.key === 'o') { event.preventDefault(); void openRef.current(); }
      if (event.key === '/' && searchInput.current) { event.preventDefault(); searchInput.current.focus(); }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);
  useEffect(() => {
    const row = line === null ? null : viewport.current?.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (row && viewport.current) viewport.current.scrollTop = row.offsetTop - viewport.current.clientHeight / 3;
  }, [line, log, level, query]);
  function jump(target: number) { setLevel('All'); setQuery(''); onSelectLine(target); }
  async function copyLink() { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1600); }

  if (log === null) return <div className="log-card log-card-locked">
    <div className="log-card-head"><div><strong>eden_log.txt</strong><span>Private · uploaded {formatDate(report.createdAt)}</span></div><a className="text-link" href={`/api/maintainer/reports/${report.id}/log`} download="eden_log.txt"><Download size={15} /> Download .txt</a></div>
    <div className="log-locked"><LockKeyhole size={20} /><p>Opening or downloading this log creates an access audit record.</p><button type="button" className="button" onClick={() => { void open(); }} disabled={busy}>{busy ? 'Opening…' : 'Open private log'} <kbd>o</kbd></button>{error && <p className="field-error" role="alert">{error}</p>}</div>
  </div>;
  return <>
    <div className="log-card">
      <div className="log-card-head"><div><strong>eden_log.txt</strong><span>{formatBytes(new TextEncoder().encode(log).length)} · {lines.length.toLocaleString()} lines · uploaded {formatDate(report.createdAt)}</span></div>
        {line !== null && <button type="button" className="text-link" onClick={() => { void copyLink(); }}><Link2 size={15} /> {copied ? 'Copied' : 'Copy link to line'}</button>}
        <a className="text-link" href={`/api/maintainer/reports/${report.id}/log`} download="eden_log.txt"><Download size={15} /> Download .txt</a>
      </div>
      <div className="log-toolbar">
        <div className="log-levels" role="group" aria-label="Filter log by level">
          {['All', ...logLevels.filter(name => levelCounts[name])].map(name => <button key={name} type="button" aria-pressed={level === name} className={`level-${name.toLowerCase()}`} onClick={() => setLevel(name)}>{name}{name !== 'All' && <span>{levelCounts[name]}</span>}</button>)}
        </div>
        <label className="log-search"><input ref={searchInput} type="search" aria-label="Search the private log" aria-keyshortcuts="/" placeholder="Search the log" value={query} onChange={event => setQuery(event.target.value)} /><kbd aria-hidden="true">/</kbd></label>
      </div>
      {jumps.length > 0 && <div className="log-jumps"><span>Jump to</span>{jumps.map(({ label, target }) => <button key={label} type="button" className={label.startsWith('First') ? 'is-problem' : undefined} onClick={() => jump(target.number)}>{label} · line {target.number.toLocaleString()}</button>)}</div>}
      <div className="log-viewport" ref={viewport} tabIndex={0} role="region" aria-label="Private log lines">
        {visible.map(entry => <div key={entry.number} data-line={entry.number} className={`log-row level-${entry.level.toLowerCase() || 'raw'}${entry.number === line ? ' is-selected' : ''}`}>
          <button type="button" tabIndex={-1} className="log-number" onClick={() => onSelectLine(entry.number)} aria-label={`Select line ${entry.number}`}>{entry.number.toLocaleString()}</button>
          {entry.time ? <><span className="log-time">[{entry.time}]</span><span className="log-module">{entry.module}</span><span className="log-level">&lt;{entry.level}&gt;</span><code>{entry.source && <span className="log-source">{highlight(entry.source, query)} </span>}{highlight(entry.message, query)}</code></> : <code className="log-plain">{highlight(entry.text, query)}</code>}
        </div>)}
        {visible.length === 0 && <p className="log-none">No lines match this filter.</p>}
      </div>
      <div className="log-card-foot">Showing {visible.length.toLocaleString()} of {lines.length.toLocaleString()} lines{query && ` matching “${query}”`}{line !== null && ` · line ${line.toLocaleString()} selected`}</div>
    </div>
    <FieldCheck report={report} log={log} />
  </>;
}

const normalize = (value: string) => value.toLowerCase().replace(/(\d)\.0+(?!\d)/g, '$1').replace(/\bgib\b/g, 'gb').replace(/\s+/g, ' ').trim();
const settingsMap = (text: string) => new Map(text.split('\n').flatMap(line => { const at = line.indexOf(': '); return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 2).trim()] as const] : []; }));
function FieldCheck({ report, log }: { report: MaintainerReport; log: string }) {
  const found = useMemo(() => extractLogFields(log), [log]);
  const rows = ([
    ['Lichii build', report.build, found.build], ['Game version', report.gameVersion, found.gameVersion], ['CPU', report.cpu, found.cpu],
    ['GPU', report.gpu, found.gpu], ['GPU driver', report.driver, found.driver], ['Operating system', report.os, found.os],
    ['RAM', report.ram, found.ram], ['Graphics API', report.graphicsApi, found.graphicsApi],
    ...[...settingsMap(found.settings ?? '')].flatMap(([label, logged]) => { const entered = settingsMap(report.settings).get(label); return entered === undefined ? [] : [[label, entered, logged] as const]; }),
  ] satisfies (readonly [string, string, string | undefined])[]).flatMap(([label, entered, logged]) => {
    if (!logged) return [];
    const a = normalize(entered);
    const b = normalize(logged);
    return [{ label, entered, logged, match: Boolean(a) && (a === b || a.includes(b) || b.includes(a)) }];
  });
  const differences = rows.filter(row => !row.match).length;
  return <section className="field-check" aria-labelledby="field-check-heading">
    <div className="section-heading"><h2 id="field-check-heading">Reporter’s fields against the log</h2><span className="muted">{rows.length ? `${differences} ${differences === 1 ? 'difference' : 'differences'}` : 'Nothing to compare'}</span></div>
    {rows.length ? <div className="table-scroll"><table className="field-check-table">
      <thead><tr><th>Field</th><th>Reporter entered</th><th>Log says</th><th><span className="sr-only">Result</span></th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.label} className={row.match ? undefined : 'is-different'}><th scope="row">{row.label}</th><td className="mono" data-label="Entered">{row.entered || '—'}</td><td className="mono" data-label="Log">{row.logged}</td><td><span className={`check-result ${row.match ? 'is-match' : 'is-different'}`}>{row.match ? 'Match' : 'Differs'}</span></td></tr>)}</tbody>
    </table></div> : <p className="muted">The log has no system information lines to compare.</p>}
  </section>;
}
