export function isPublicTrackingPath(pathname: string): boolean {
  return ['/', '/guide', '/privacy', '/reports'].includes(pathname)
    || /^\/games\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname)
    || /^\/reports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pathname);
}

export function trackingAllowed(pathname: string, privacySignal: boolean): boolean {
  return isPublicTrackingPath(pathname) && !privacySignal;
}

export function needsDocumentNavigation(from: string, to: string): boolean {
  return isPublicTrackingPath(from) !== isPublicTrackingPath(to);
}
