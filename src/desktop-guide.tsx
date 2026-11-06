import type { ReactNode } from 'react';
import { ArrowRight, Check, Info, LockKeyhole, MousePointer2, Search } from 'lucide-react';
import { Link } from './navigation.tsx';
import { Breadcrumbs } from './components.tsx';

const steps = [
  ['play', 'Play, then stop'],
  ['menu', 'Right-click the game'],
  ['catalog', 'Pick the exact title'],
  ['review', 'Review the draft'],
  ['consent', 'Tick both statements'],
  ['submit', 'Submit'],
] as const;

function Pin({ n }: { n: number }) {
  return <b className="tut-pin" aria-hidden="true">{n}</b>;
}

function Figure({ kind, callouts, children }: { kind: 'screenshot' | 'illustration'; callouts: ReactNode[]; children: ReactNode }) {
  return <figure className="tut-figure">
    {children}
    <figcaption>
      <span className="tut-kind">{kind === 'screenshot' ? 'Screenshot of a test dialog with synthetic data' : 'Illustration with example values'}</span>
      <ol className="tut-callouts">{callouts.map((callout, i) => <li key={i}><Pin n={i + 1} /><span>{callout}</span></li>)}</ol>
    </figcaption>
  </figure>;
}

function Mock({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return <div className="tut-window" role="img" aria-label={label}>
    <div className="tut-titlebar"><span>{title}</span><span aria-hidden="true">— ▢ ✕</span></div>
    {children}
  </div>;
}

function Step({ id, number, title, children, figure }: { id: string; number: string; title: string; children: ReactNode; figure: ReactNode }) {
  return <section id={id} className="tut-step" aria-labelledby={id + '-title'}>
    <div className="tut-copy"><span className="step-number">{number}</span><h2 id={id + '-title'}>{title}</h2>{children}</div>
    {figure}
  </section>;
}

export function DesktopGuide() {
  return <>
    <Breadcrumbs items={[{ label: 'How to report', to: '/guide' }, { label: 'Lichii desktop app' }]} />
    <div className="tut-intro">
      <span className="eyebrow">Lichii desktop app · illustrated guide</span>
      <h1 className="page-title">Report from Lichii<br />in six steps.</h1>
      <p className="page-description">Finished a session? Send your result straight from the game list. No account, no log upload. You see every field before anything is sent.</p>
      <div className="notice tut-availability"><Info size={20} /><p>This menu item exists only in <strong>Lichii builds that include desktop reporting</strong>. If you can’t find it in your build, the <Link className="text-link" to="/submit">website form</Link> works now and accepts the same report.</p></div>
    </div>
    <nav className="tut-overview" aria-label="Steps in this guide">
      <ol>{steps.map(([id, label], i) => <li key={id}><a href={'#' + id}><span>{String(i + 1).padStart(2, '0')}</span>{label}</a></li>)}</ol>
    </nav>
    <div className="tut-sharing">
      <div><h2>Public after you submit</h2><ul><li>Your nickname, or Anonymous</li><li>Your X handle, if you add one</li><li>Your rating, summary and report text</li><li>Build, hardware and settings</li></ul></div>
      <div><LockKeyhole size={20} /><h2>Never uploaded</h2><ul><li>Logs</li><li>Mod files and game files</li><li>Saves, keys and firmware</li><li>File paths and play history</li></ul></div>
      <p>No account is needed. Like any website, the server sees your IP address and uses it for rate limiting.</p>
    </div>
    <div className="tut-steps">
      <Step id="play" number="01" title="Play, then stop the game." figure={<Figure kind="illustration" callouts={['Emulation → Stop ends the session.', 'Keep Lichii open. Closing it discards the session.']}>
        <Mock title="Lichii" label="Illustration of the Lichii window with the Emulation menu open and Stop highlighted. The window stays open.">
          <div className="tut-menubar"><span>File</span><span className="is-open">Emulation</span><span>View</span><span>Tools</span><span>Help</span><span className="tut-keep is-target">Lichii stays open<Pin n={2} /></span></div>
          <div className="tut-stage">
            <div className="tut-menu tut-menu-emulation"><span>Pause</span><span className="is-target">Stop<Pin n={1} /></span><span>Restart</span><span>Configure Current Game…</span></div>
            <div className="tut-game-screen"><span>Example Switch 2 game</span><small>Session in progress</small></div>
          </div>
        </Mock>
      </Figure>}>
        <p>Play a Switch 2 game in Lichii as usual. When you’re done, choose <strong>Emulation → Stop</strong> and stay in Lichii.</p>
        <p>Lichii keeps only the latest completed session, and only in memory. Starting another game replaces it. Closing Lichii discards it. No play history is saved.</p>
      </Step>

      <Step id="menu" number="02" title="Right-click the same game." figure={<Figure kind="illustration" callouts={['The game you just stopped.', 'The last item in its menu.']}>
        <Mock title="Lichii" label="Illustration of the Lichii game list. The game that was just played is right-clicked, and Submit compatibility report is highlighted at the bottom of its menu.">
          <div className="tut-list">
            <div className="tut-list-head"><span>Name</span><span>Play time</span></div>
            <div className="tut-row is-target"><span>Example Switch 2 game</span><span>0h 42m</span><Pin n={1} /></div>
            <div className="tut-row"><span>Another example game</span><span>3h 05m</span></div>
            <div className="tut-row"><span>Third example game</span><span>—</span></div>
            <div className="tut-menu tut-menu-context">
              <span>Favorite</span><span>Start Game</span><i /><span>Open Save Data Location</span><span>Open Mod Data Location</span><span className="muted">…</span><i /><span>Configure Game</span>
              <span className="is-target tut-cursor">Submit compatibility report…<MousePointer2 size={15} /><Pin n={2} /></span>
            </div>
          </div>
        </Mock>
      </Figure>}>
        <p>In the game list, right-click the game you just played and choose <strong>Submit compatibility report…</strong>, the bottom item of the menu.</p>
        <p>It appears only for that one game, after its session has ended. Other games don’t show it.</p>
      </Step>

      <Step id="catalog" number="03" title="Pick the exact website title." figure={<Figure kind="illustration" callouts={['Prefilled with the title Lichii knows. You can edit it.', 'Search runs only when you click it.', 'Choose the exact title. Previous and Next page through results.', 'Confirm it before you continue.']}>
        <Mock title="Submit compatibility report" label="Illustration of the catalog search at the top of the report dialog: a prefilled search box, a Search catalog button, a results list with paging buttons, a Confirm game button and a confirmed game line.">
          <div className="tut-dialog">
            <div className="tut-search-row"><span className="tut-input is-target">Example Switch 2 game<Pin n={1} /></span><span className="tut-btn is-target"><Search size={13} /> Search catalog<Pin n={2} /></span></div>
            <small className="tut-hint">Search sends only the text above to lichii.zortos.me.</small>
            <div className="tut-search-row"><span className="tut-input tut-select is-target">Example Switch 2 game<Pin n={3} /></span><span className="tut-btn is-disabled">Previous</span><span className="tut-btn is-disabled">Next</span><span className="tut-btn is-target">Confirm game<Pin n={4} /></span></div>
            <p className="tut-confirmed"><Check size={14} /> Confirmed: Example Switch 2 game (catalog ID 12345)</p>
          </div>
        </Mock>
      </Figure>}>
        <p>The dialog opens with the game’s known title in the search box. If Lichii doesn’t know the title, the box stays empty and you type it.</p>
        <p>Click <strong>Search catalog</strong>, select the exact title as it appears on this website, then click <strong>Confirm game</strong>. Lichii never guesses the website entry from a Nintendo title ID, so this choice is yours.</p>
      </Step>

      <Step id="review" number="04" title="Review the three tabs." figure={<div className="tut-figure-stack">
        <Figure kind="screenshot" callouts={['Three tabs: Experience, System and settings, Public preview.', 'Public nickname, Anonymous by default, and an optional X handle.', 'Your own compatibility rating.', 'How far you played and what worked or failed, in your words.']}>
          <div className="tut-shot">
            <a href="/tutorial/desktop-report-experience.webp" aria-label="Open the Experience tab screenshot at full size"><img src="/tutorial/desktop-report-experience.webp" width="760" height="790" loading="lazy" alt="Experience tab of the Submit compatibility report dialog, filled with synthetic test values: nickname Anonymous, compatibility Playable, a short summary, progress and details." /></a>
            <span className="tut-box box-exp-tabs"><Pin n={1} /></span><span className="tut-box box-exp-name"><Pin n={2} /></span><span className="tut-box box-exp-rating"><Pin n={3} /></span><span className="tut-box box-exp-text"><Pin n={4} /></span>
          </div>
        </Figure>
        <Figure kind="screenshot" callouts={['Prefills describe launch settings, not measured performance.', 'Build, game version and hardware fill in where known. Every field stays editable.', 'Graphics API and launch settings. Fix anything you changed during play.']}>
          <div className="tut-shot">
            <a href="/tutorial/desktop-report-system.webp" aria-label="Open the System and settings tab screenshot at full size"><img src="/tutorial/desktop-report-system.webp" width="760" height="790" loading="lazy" alt="System and settings tab with synthetic prefilled values: Lichii build, game version 1.0.0, example CPU, GPU and driver, operating system, 16 GiB RAM, Vulkan and launch settings." /></a>
            <span className="tut-box box-sys-note"><Pin n={1} /></span><span className="tut-box box-sys-fields"><Pin n={2} /></span><span className="tut-box box-sys-settings"><Pin n={3} /></span>
          </div>
        </Figure>
        <Figure kind="illustration" callouts={['Exactly what will be published. It is read-only. The highlighted gameId is the game you confirmed in step 3.']}>
          <Mock title="Public preview" label="Illustration of the read-only Public preview tab, showing the report fields as JSON with example values.">
            <pre className="tut-json is-target"><Pin n={1} />{'{\n  "build": "Example Lichii build",\n  "details": "Example: menus and first area worked.",\n  "gameId": '}<mark>12345</mark>{',\n  "gameVersion": "1.0.0",\n  "gpu": "Example GPU",\n  "graphicsApi": "Vulkan",\n  "mods": "",\n  "name": "Anonymous",\n  "outcome": "Playable",\n  "updates": "Loaded NUP package",\n  …\n}'}</pre>
          </Mock>
        </Figure>
      </div>}>
        <p><strong>Experience</strong> holds your nickname, optional X handle, rating, summary, progress, details and optional steps to reproduce. Lichii doesn’t measure these: the rating, progress and details are your own judgment.</p>
        <p><strong>System and settings</strong> fills in the build, game version, CPU, GPU, driver, operating system, RAM, graphics API, launch settings and enabled update and mod names where Lichii knows them. Everything stays editable. Anything it can’t read says <em>Unknown</em>. An update inside a NUP package appears as <em>Loaded NUP package</em>.</p>
        <p>Disabled mods, file paths and file contents are left out. <strong>Public preview</strong> shows exactly what will be published.</p>
        <p className="tut-limits">Limits: nickname 60 characters, X handle 15, summary 120, progress 500, details 6,000, steps to reproduce 3,000, settings 3,000, updates and mods 500 each.</p>
      </Step>

      <Step id="consent" number="05" title="Tick both statements." figure={<Figure kind="illustration" callouts={['Both boxes start unchecked.', 'Any edit to the draft clears both again.']}>
        <Mock title="Submit compatibility report" label="Illustration of the two unchecked attestation checkboxes below the report tabs.">
          <div className="tut-dialog">
            <p className="tut-hint">All report fields in the preview will be public. Logs, files, local title IDs and play history are not sent.</p>
            <div className="tut-consents is-target"><Pin n={1} />
              <span><i className="tut-check" />I understand my name, optional X handle, report text, hardware and settings will be public.</span>
              <span><i className="tut-check" />My report contains no game files, keys, firmware, saves or private account details.</span>
            </div>
            <p className="tut-reset is-target">Edited the summary → both boxes cleared<Pin n={2} /></p>
          </div>
        </Mock>
      </Figure>}>
        <p>Read and check both statements yourself. They’re separate, and neither is ticked for you:</p>
        <ul><li>“I understand my name, optional X handle, report text, hardware and settings will be public.”</li><li>“My report contains no game files, keys, firmware, saves or private account details.”</li></ul>
        <p>If you change anything in the draft afterwards, both boxes clear, so you confirm the final version.</p>
      </Step>

      <Step id="submit" number="06" title="Click Submit report." figure={<Figure kind="illustration" callouts={['Clear draft empties the form. Nothing is sent.', 'Submit report enables only after both boxes are ticked.', 'Cancel closes the dialog. It can’t retract a report the server already received.', 'After success, open your public report.']}>
        <Mock title="Submit compatibility report" label="Illustration of the dialog buttons Clear draft, Submit report and Cancel, followed by a success message with an Open public report button.">
          <div className="tut-dialog">
            <div className="tut-buttons"><span className="tut-btn is-target">Clear draft<Pin n={1} /></span><span className="tut-btn primary is-target">Submit report<Pin n={2} /></span><span className="tut-btn is-target">Cancel<Pin n={3} /></span></div>
            <div className="tut-success"><Check size={16} /><span className="tut-success-text">Report submitted. It is public. Thank you.</span><span className="tut-btn is-target">Open public report<Pin n={4} /></span></div>
          </div>
        </Mock>
      </Figure>}>
        <p>Nothing is sent until you click <strong>Submit report</strong>. Lichii never submits on its own and never retries in the background.</p>
        <p>If the connection fails or the answer is unclear, the dialog says so. Click Submit again to retry the unchanged draft; it reuses the same identity, so the report isn’t duplicated. A rate limit message tells you how long to wait.</p>
        <p>There’s no edit page after publishing. To remove a report, see <Link className="text-link" to="/privacy">Privacy & safety</Link>.</p>
      </Step>
    </div>
    <div className="tut-end panel">
      <div><h2>No reporting menu in your build?</h2><p>Use the website form. It works in any browser today and also takes an optional private log.</p></div>
      <div className="tut-end-actions"><Link className="button primary" to="/submit">Submit on the website <ArrowRight size={16} /></Link><Link className="button" to="/guide">Read the full reporting guide</Link></div>
    </div>
  </>;
}
