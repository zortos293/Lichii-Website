import { Databuddy } from '@databuddy/sdk/react';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { CONSENT_KEY, isPublicTrackingPath, parseConsent, trackingAllowed, type TrackingConsent } from './tracking-policy.ts';

function readConsent() {
  try { return parseConsent(localStorage.getItem(CONSENT_KEY)); }
  catch { return null; }
}

function hasPrivacySignal() {
  return navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes'
    || ('globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true);
}

function stopTracking() {
  for (const script of document.querySelectorAll('script[data-databuddy-injected], script[data-databuddy-replay-injected]')) script.setAttribute('data-disabled', 'true');
  if (window.databuddy) window.databuddy.options.disabled = true;
  window.databuddyReplay?.stop();
}

export function TrackingBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [publicDocument] = useState(() => isPublicTrackingPath(window.location.pathname));
  const [consent] = useState(readConsent);
  const crossingBoundary = publicDocument !== isPublicTrackingPath(location.pathname);
  useLayoutEffect(() => {
    if (crossingBoundary) {
      stopTracking();
      window.location.replace(window.location.href);
    }
  }, [crossingBoundary]);
  useEffect(() => {
    const checkConsent = () => {
      if (readConsent() !== consent || hasPrivacySignal()) {
        stopTracking();
        if (readConsent() !== consent) window.location.reload();
      }
    };
    window.addEventListener('storage', checkConsent);
    window.addEventListener('pageshow', checkConsent);
    return () => {
      window.removeEventListener('storage', checkConsent);
      window.removeEventListener('pageshow', checkConsent);
    };
  }, [consent]);
  if (crossingBoundary) return null;
  return <>{publicDocument && trackingAllowed(location.pathname, consent, hasPrivacySignal()) && <Databuddy
    clientId="da37ce88-b18d-4639-a886-b2e74119b0ad"
    trackWebVitals
    replay={consent === 'replay' ? { maskText: true, recordIframes: false } : false}
    trackErrors={false}
    trackAttributes={false}
    trackInteractions={false}
    trackOutgoingLinks={false}
    trackHashChanges={false}
    skipPatterns={['/submit', '/submit/**', '/submitted/**', '/maintainer', '/maintainer/**', '/api/**']}
  />}{children}</>;
}

export function TrackingPreferences() {
  const [consent] = useState(readConsent);
  const [open, setOpen] = useState(consent === null);
  const [error, setError] = useState('');
  function choose(value: TrackingConsent) {
    try { localStorage.setItem(CONSENT_KEY, value); }
    catch { stopTracking(); setError('Your browser could not save this choice. Check your browser’s storage settings and try again.'); return; }
    stopTracking();
    window.location.reload();
  }
  return <section className="tracking-preferences" data-replay-block="" aria-label="Tracking preferences">
    <button className="text-link" onClick={() => setOpen(value => !value)} aria-expanded={open}>Tracking preferences</button>
    {open && <div className="panel tracking-options"><h2>Optional analytics and session replay</h2>
      <p>With your permission, Databuddy measures public-page visits and Web Vitals. Session replay is a separate opt-in that records masked page layouts and interactions. Reporting, confirmation and maintainer pages are excluded. You can change your choice here at any time.</p>
      <p className="fine-print">Current choice: {consent === 'replay' ? 'analytics and replay' : consent === 'analytics' ? 'analytics only' : 'off'}. Saving a choice reloads this page. <a className="text-link" href="/privacy">Read the privacy details</a>.</p>
      {hasPrivacySignal() && <p>Your browser’s Do Not Track or Global Privacy Control signal keeps optional tracking off.</p>}
      <div className="tracking-actions"><button className="button" onClick={() => choose('off')}>Reject optional tracking</button><button className="button" disabled={hasPrivacySignal()} onClick={() => choose('analytics')}>Allow analytics only</button><button className="button" disabled={hasPrivacySignal()} onClick={() => choose('replay')}>Allow analytics and replay</button></div>
      {error && <p role="alert">{error}</p>}
    </div>}
  </section>;
}
