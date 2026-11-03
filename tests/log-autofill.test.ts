import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLogFields, validateLog } from '../shared/log.ts';

const startup = String.raw`[   0.001001] Frontend <Info> qt_common\qt_common.cpp:245:Init: Lichii Version: development-test-build
[   0.002002] Frontend <Info> qt_common\qt_common.cpp:261:Init: Host CPU: Test CPU
[   0.003003] Frontend <Info> qt_common\qt_common.cpp:267:Init: Host OS: Windows test system
[   0.004004] Frontend <Info> qt_common\qt_common.cpp:269:Init: Host RAM: 32.00 GiB`;
const session = String.raw`${startup}
[  13.001001] Config <Info> common\settings.cpp:138:LogSettings: M- Renderer.gpu_accuracy: Low
[  13.002002] Config <Info> common\settings.cpp:138:LogSettings: -- Renderer.backend: Vulkan
[  13.003003] Config <Info> common\settings.cpp:138:LogSettings: -- Renderer.resolution_setup: Res1X
[  13.004004] Config <Info> common\settings.cpp:138:LogSettings: M- Renderer.use_asynchronous_shaders: true
[  13.005005] Config <Info> common\settings.cpp:138:LogSettings: -- System.use_docked_mode: Docked
[  13.006006] Config <Info> common\settings.cpp:138:LogSettings: -- Controls.touch_device: private-input-data
[  13.007007] Config <Info> common\settings.cpp:138:LogSettings: -- System.device_name: private-device-name
[  14.001001] Render.Vulkan <Info> video_core\renderer_vulkan\renderer_vulkan.cpp:264:Report: Driver: Test driver 1.2
[  14.002002] Render.Vulkan <Info> video_core\renderer_vulkan\renderer_vulkan.cpp:265:Report: Device: Test GPU
[  14.003003] Render.Vulkan <Info> video_core\renderer_vulkan\renderer_vulkan.cpp:266:Report: Vulkan: 1.4.0
[  14.004004] Frontend <Info> yuzu\main_window.cpp:2116:BootGame: Booting game: 0100000000000000 | Test game | 
[  90.001001] Config <Info> common\settings.cpp:138:LogSettings: -- Renderer.gpu_accuracy: High`;

test('autofills Windows session hardware and allowlisted logged settings, keeping the latest value', () => {
  assert.equal(validateLog(session), null);
  assert.deepEqual(extractLogFields(session), {
    build: 'development-test-build', cpu: 'Test CPU', os: 'Windows test system', ram: '32.00 GiB',
    driver: 'Test driver 1.2', gpu: 'Test GPU', graphicsApi: 'Vulkan',
    settings: 'GPU accuracy: High\nGraphics backend: Vulkan\nResolution: Res1X\nAsynchronous shaders: true\nConsole mode: Docked',
  });
  assert.deepEqual(extractLogFields(session.replaceAll('\\', '/')), extractLogFields(session));
});

test('startup-only logs do not fabricate missing hardware, settings or game version', () => {
  assert.deepEqual(extractLogFields(startup), { build: 'development-test-build', cpu: 'Test CPU', os: 'Windows test system', ram: '32.00 GiB' });
});

test('graphics backend can be detected from settings without a renderer report', () => {
  const text = '[ 1.000001] Config <Info> common/settings.cpp:138:LogSettings: -- Renderer.backend: OpenGL';
  assert.deepEqual(extractLogFields(text), { graphicsApi: 'OpenGL', settings: 'Graphics backend: OpenGL' });
  for (const invalid of [text.replace('<Info>', '<Error>'), text.replace('settings.cpp', 'unrelated.cpp'), text.replace('OpenGL', 'private/path/to/file')]) assert.deepEqual(extractLogFields(invalid), {});
});

test('a later boot with an empty version never reuses an earlier game version', () => {
  const text = `${session}\n[ 91.000001] Frontend <Info> yuzu/main_window.cpp:2116:BootGame: Booting game: 0100000000000000 | Earlier game | 1.2.3\n[ 92.000001] Frontend <Info> yuzu/main_window.cpp:2116:BootGame: Booting game: 0100000000000001 | Latest game | `;
  assert.equal(extractLogFields(text).gameVersion, undefined);
});
