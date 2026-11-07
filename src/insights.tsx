import { siApple, siLinux, siSteamdeck } from 'simple-icons';
import { ArrowRight, Monitor } from 'lucide-react';
import { Link } from './navigation.tsx';
import { outcomes, type Summary } from '../shared/domain.ts';
import { buildLabel, platformLabels, platforms, playablePercent, type Outcome, type Platform, type Tally } from '../shared/compat.ts';
import { Status, relativeTime } from './components.tsx';

const brandPaths = { 'steam-deck': siSteamdeck.path, linux: siLinux.path, macos: siApple.path };
export function PlatformIcon({ platform, size = 15 }: { platform: Platform; size?: number }) {
  if (platform === 'other') return <Monitor size={size} aria-hidden="true" className="platform-icon" />;
  return <svg className="platform-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
    <path fill="currentColor" d={platform === 'windows' ? 'M2 2h9.5v9.5H2zM12.5 2H22v9.5h-9.5zM2 12.5h9.5V22H2zM12.5 12.5H22V22h-9.5z' : brandPaths[platform]} />
  </svg>;
}

export function PlatformToggles({ selected, onChange }: { selected: readonly string[]; onChange: (next: string[]) => void }) {
  return <div className="platform-toggles" role="group" aria-label="Filter by platform">
    {platforms.map(platform => {
      const pressed = selected.includes(platform);
      return <button key={platform} type="button" aria-pressed={pressed} onClick={() => onChange(pressed ? selected.filter(value => value !== platform) : [...selected, platform])}>
        <PlatformIcon platform={platform} />{platformLabels[platform]}
      </button>;
    })}
  </div>;
}

export function BuildSelect({ builds, value, onChange }: { builds: Summary['builds'] | null; value: string; onChange: (value: string) => void }) {
  return <label>Build <select aria-label="Filter by Lichii build" value={value} onChange={e => onChange(e.target.value)}>
    <option value="">Any build</option>
    {value && !builds?.some(entry => String(entry.build ?? 'other') === value) && <option value={value}>{value === 'other' ? buildLabel(null) : buildLabel(Number(value))}</option>}
    {builds?.map(entry => <option key={entry.build ?? 'other'} value={entry.build ?? 'other'}>{buildLabel(entry.build)} · {entry.total}</option>)}
  </select></label>;
}

export function DistributionBar({ tally, label }: { tally: Pick<Tally, 'counts' | 'total'>; label: string }) {
  let x = 0;
  const description = tally.total ? outcomes.filter(o => tally.counts[o]).map(o => `${tally.counts[o]} ${o}`).join(', ') : 'no reports';
  return <svg className="distribution-bar" viewBox="0 0 1000 10" preserveAspectRatio="none" role="img" aria-label={`${label}: ${description}`}>
    {tally.total > 0 && outcomes.map(outcome => {
      const width = tally.counts[outcome] / tally.total * 1000;
      const rect = width > 0 ? <rect key={outcome} className={`track-${outcome.toLowerCase()}`} x={x} y="0" width={Math.max(width - 4, 2)} height="10" /> : null;
      x += width;
      return rect;
    })}
  </svg>;
}

export const playableLine = (tally: Pick<Tally, 'playable' | 'total'>) => `${tally.playable} of ${tally.total} · ${playablePercent(tally)}%`;

export function MedianBlock({ tally, scope }: { tally: Tally; scope: string }) {
  return <div className="median-block">
    <span className="eyebrow">Median result · {scope}</span>
    {tally.median ? <Status value={tally.median} large /> : <span className="median-empty">No reports yet</span>}
    <p>{tally.median
      ? `The middle rating of ${tally.total} ${tally.total === 1 ? 'report' : 'reports'}, ranked Unplayable < Loads < Runs < Playable < Perfect. ${playablePercent(tally)}% are Playable or Perfect.`
      : 'The median appears once players submit reports. Every rating comes from a real test.'}</p>
  </div>;
}

export function PlatformBreakdown({ entries, linkFor }: { entries: Summary['platforms']; linkFor?: (platform: Platform) => string }) {
  return <div className="platform-breakdown">
    {entries.map(entry => {
      const name = <><PlatformIcon platform={entry.platform} size={16} />{platformLabels[entry.platform]}</>;
      return <div key={entry.platform} className={`platform-row ${entry.total ? '' : 'is-empty'}`}>
        <div className="platform-row-head">
          {linkFor && entry.total ? <Link className="platform-name" to={linkFor(entry.platform)}>{name}</Link> : <span className="platform-name">{name}</span>}
          <span className="mono">{entry.total ? playableLine(entry) : 'No reports yet'}</span>
        </div>
        <DistributionBar tally={entry} label={`${platformLabels[entry.platform]} results`} />
        <div className="platform-row-foot"><span>{entry.total ? <>Median <Status value={entry.median ?? 'Untested'} /></> : 'Untested on this platform'}</span><span>{entry.total} {entry.total === 1 ? 'report' : 'reports'}</span></div>
      </div>;
    })}
  </div>;
}

export function BuildStrip({ builds }: { builds: { build: number; status: Outcome | 'Untested' }[] }) {
  if (!builds.length) return <span className="muted">—</span>;
  return <span className="build-strip" role="img" aria-label={`Last ${builds.length} builds: ${builds.map(entry => `build ${entry.build} ${entry.status}`).join(', ')}`}>
    {builds.map(entry => <span key={entry.build} className={`strip-cell status-${entry.status.toLowerCase()}`} title={`${buildLabel(entry.build)}: ${entry.status === 'Untested' ? 'no reports' : `best result ${entry.status}`}`} />)}
  </span>;
}

export function BuildTable({ builds, linkFor, caption }: { builds: Summary['builds']; linkFor: (build: number | null) => string; caption: string }) {
  return <div className="table-scroll"><table className="build-table">
    <caption className="sr-only">{caption}</caption>
    <thead><tr><th>Lichii build</th><th>Results</th><th>Playable or better</th><th>Median</th><th className="number-col">Games</th><th className="number-col">Reports</th><th>Latest</th></tr></thead>
    <tbody>{builds.map(entry => <tr key={entry.build ?? 'other'}>
      <td><Link to={linkFor(entry.build)} className="build-name">{buildLabel(entry.build)} <ArrowRight size={13} /></Link></td>
      <td className="build-bar"><DistributionBar tally={entry} label={`${buildLabel(entry.build)} results`} /></td>
      <td className="mono">{playableLine(entry)}</td>
      <td><Status value={entry.median ?? 'Untested'} /></td>
      <td className="number-col mono">{entry.games}</td>
      <td className="number-col mono">{entry.total}</td>
      <td className="muted">{relativeTime(entry.latestAt)}</td>
    </tr>)}</tbody>
  </table></div>;
}
