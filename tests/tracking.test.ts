import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicTrackingPath, needsDocumentNavigation, trackingAllowed } from '../src/tracking-policy.ts';

test('tracking is allowlisted and private or unknown routes fail closed', () => {
  for (const path of ['/', '/guide', '/privacy', '/reports', '/games/mario-kart-world', '/reports/12345678-1234-1234-1234-123456789abc']) {
    assert.equal(isPublicTrackingPath(path), true, path);
  }
  for (const path of ['/submit', '/submit/', '/submitted/123', '/maintainer', '/maintainer/reports/123/log', '/api/maintainer/reports', '/unknown', '/games/a/private', '/games/%2fmaintainer', '/reports/not-an-id', '/Submit']) {
    assert.equal(isPublicTrackingPath(path), false, path);
    assert.equal(trackingAllowed(path, false), false, path);
  }
});

test('public analytics is automatic and respects browser privacy signals', () => {
  assert.equal(trackingAllowed('/', false), true);
  assert.equal(trackingAllowed('/', true), false);
});

test('crossing the privacy boundary requires a new document in either direction', () => {
  assert.equal(needsDocumentNavigation('/', '/submit'), true);
  assert.equal(needsDocumentNavigation('/games/mario', '/maintainer'), true);
  assert.equal(needsDocumentNavigation('/submitted/id', '/reports'), true);
  assert.equal(needsDocumentNavigation('/maintainer', '/'), true);
  assert.equal(needsDocumentNavigation('/submit', '/submitted/id'), false);
  assert.equal(needsDocumentNavigation('/', '/guide'), false);
});
