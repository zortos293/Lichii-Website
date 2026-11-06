import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicTrackingPath, needsDocumentNavigation, parseConsent, trackingAllowed } from '../src/tracking-policy.ts';

test('tracking is allowlisted and private or unknown routes fail closed', () => {
  for (const path of ['/', '/guide', '/privacy', '/reports', '/games/mario-kart-world', '/reports/12345678-1234-1234-1234-123456789abc']) {
    assert.equal(isPublicTrackingPath(path), true, path);
  }
  for (const path of ['/submit', '/submit/', '/submitted/123', '/maintainer', '/maintainer/reports/123/log', '/api/maintainer/reports', '/unknown', '/games/a/private', '/games/%2fmaintainer', '/reports/not-an-id', '/Submit']) {
    assert.equal(isPublicTrackingPath(path), false, path);
    assert.equal(trackingAllowed(path, 'replay', false), false, path);
  }
});

test('analytics and replay both require explicit valid consent and respect privacy signals', () => {
  for (const value of [null, '', 'true', 'all', '{"analytics":true}']) assert.equal(parseConsent(value), null);
  for (const consent of ['off', 'analytics', 'replay'] as const) assert.equal(parseConsent(consent), consent);
  for (const consent of [null, 'off', 'analytics', 'replay'] as const) {
    assert.equal(trackingAllowed('/', consent, false), consent === 'analytics' || consent === 'replay');
    assert.equal(trackingAllowed('/', consent, true), false);
  }
});

test('crossing the privacy boundary requires a new document in either direction', () => {
  assert.equal(needsDocumentNavigation('/', '/submit'), true);
  assert.equal(needsDocumentNavigation('/games/mario', '/maintainer'), true);
  assert.equal(needsDocumentNavigation('/submitted/id', '/reports'), true);
  assert.equal(needsDocumentNavigation('/maintainer', '/'), true);
  assert.equal(needsDocumentNavigation('/submit', '/submitted/id'), false);
  assert.equal(needsDocumentNavigation('/', '/guide'), false);
});
