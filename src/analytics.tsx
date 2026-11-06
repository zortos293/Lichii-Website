import { Databuddy } from '@databuddy/sdk/react';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { databuddyWebsiteId } from '../shared/databuddy.ts';
import { isPublicTrackingPath, trackingAllowed } from './tracking-policy.ts';

function hasPrivacySignal() {
  return navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes'
    || ('globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true);
}

function stopTracking() {
  for (const script of document.querySelectorAll('script[data-databuddy-injected]')) script.setAttribute('data-disabled', 'true');
  if (window.databuddy) window.databuddy.options.disabled = true;
}

export function TrackingBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [publicDocument] = useState(() => isPublicTrackingPath(window.location.pathname));
  const crossingBoundary = publicDocument !== isPublicTrackingPath(location.pathname);
  useLayoutEffect(() => {
    if (crossingBoundary) {
      stopTracking();
      window.location.replace(window.location.href);
    }
  }, [crossingBoundary]);
  useEffect(() => {
    const checkPrivacySignal = () => { if (hasPrivacySignal()) stopTracking(); };
    window.addEventListener('pageshow', checkPrivacySignal);
    return () => window.removeEventListener('pageshow', checkPrivacySignal);
  }, []);
  if (crossingBoundary) return null;
  return <>{publicDocument && trackingAllowed(location.pathname, hasPrivacySignal()) && <Databuddy
    clientId={databuddyWebsiteId}
    trackWebVitals
    replay={false}
    trackErrors={false}
    trackAttributes={false}
    trackInteractions={false}
    trackOutgoingLinks={false}
    trackHashChanges={false}
    skipPatterns={['/submit', '/submit/**', '/submitted/**', '/maintainer', '/maintainer/**', '/api/**']}
  />}{children}</>;
}
