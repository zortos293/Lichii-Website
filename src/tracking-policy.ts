export const CONSENT_KEY = 'lichii-tracking-consent-v1';
export type TrackingConsent = 'off' | 'analytics' | 'replay';

export function parseConsent(value: string | null): TrackingConsent | null {
  return value === 'off' || value === 'analytics' || value === 'replay' ? value : null;
}

export function isPublicTrackingPath(pathname: string): boolean {
  return ['/', '/guide', '/privacy', '/reports'].includes(pathname)
    || /^\/games\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname)
    || /^\/reports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pathname);
}

export function trackingAllowed(pathname: string, consent: TrackingConsent | null, privacySignal: boolean): boolean {
  return isPublicTrackingPath(pathname) && (consent === 'analytics' || consent === 'replay') && !privacySignal;
}

export function needsDocumentNavigation(from: string, to: string): boolean {
  return isPublicTrackingPath(from) !== isPublicTrackingPath(to);
}
