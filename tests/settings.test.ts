import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySettings, readSettings, writeSettings } from '../shared/settings.ts';
import { extractLogFields } from '../shared/log.ts';
import { submissionSchema } from '../shared/domain.ts';
import { validSubmission } from './fixtures.ts';

test('settings start unknown rather than guessing defaults or disabled shaders', () => {
  assert.equal(writeSettings(emptySettings), 'Resolution: Unknown\nGPU accuracy: Unknown\nAsynchronous shaders: Unknown');
  assert.deepEqual(readSettings('Graphics backend: Vulkan'), emptySettings);
  assert.deepEqual(readSettings(writeSettings(emptySettings)), emptySettings);
  assert.equal(submissionSchema.safeParse({ ...validSubmission, settings: writeSettings(emptySettings) }).success, true);
});

test('logged settings populate individual controls and preserve remaining settings', () => {
  const log = `[ 1.000001] Config <Info> common/settings.cpp:138:LogSettings: -- Renderer.resolution_setup: Res1X
[ 1.000002] Config <Info> common/settings.cpp:138:LogSettings: -- Renderer.gpu_accuracy: High
[ 1.000003] Config <Info> common/settings.cpp:138:LogSettings: -- Renderer.use_asynchronous_shaders: false
[ 1.000004] Config <Info> common/settings.cpp:138:LogSettings: -- System.use_docked_mode: Docked`;
  const fields = extractLogFields(log);
  const controls = readSettings(fields.settings ?? '');
  assert.deepEqual(controls, { resolution: 'Res1X', accuracy: 'High', asyncShaders: 'false', other: 'Console mode: Docked' });
  assert.equal(writeSettings(controls), fields.settings);
});

test('partial log settings leave absent controls and manual notes unchanged', () => {
  const current = { ...emptySettings, resolution: 'Res2X', other: 'Manual note' };
  assert.deepEqual(readSettings('GPU accuracy: Normal', current), { ...current, accuracy: 'Normal' });
  assert.deepEqual(readSettings('Asynchronous shaders: unsupported'), { ...emptySettings, other: 'Asynchronous shaders: unsupported' });
  assert.equal(readSettings('Resolution: FutureResolution').resolution, 'FutureResolution');
});

test('edited controls serialize once without stale or duplicated logged values', () => {
  const controls = readSettings('GPU accuracy: High\nAsynchronous shaders: true\nVSync: false');
  assert.equal(writeSettings({ ...controls, accuracy: 'Normal', asyncShaders: 'false' }), 'Resolution: Unknown\nGPU accuracy: Normal\nAsynchronous shaders: false\nVSync: false');
});
