import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLabel, derivePlatform, gpuFamily, lichiiBuild, medianOutcome, osLabel, playablePercent, setupSummary, tally } from '../shared/compat.ts';

test('build normalisation reads the Lichii build number from free-text build fields', () => {
  for (const [raw, build] of [
    ['Lichii build-93 (09b78bd2dfdd)', 93], ['build-93', 93], ['Build 93', 93], ['93', 93], ['  88 ', 88], ['#92', 92],
    ['Lichii Development Build | nx2-build-93', 93], ['nx2 build 93 (09b78bd)', 93], ['Lichii build-93', 93], ['build_90', 90],
    ['Lichii nx2 build 88 (55532f2) / Frizti v2', 88], ['Lichii 93', 93],
  ] as const) assert.equal(lichiiBuild(raw), build, raw);
  for (const raw of ['9.3', '8.0', 'Lichii 1973c1df56-HEAD (1973c1df56ff)', 'Lichii Development Build | nx2-3bdd53d08a-nx2', 'Lichii Frizti v2 | oot-gather-fix-765659af4c', 'development-test-build', 'test-build', 'latest', '0', 'build 0', 'v1.2.3', ''])
    assert.equal(lichiiBuild(raw), null, raw);
  assert.equal(buildLabel(93), 'Build 93'); assert.equal(buildLabel(null), 'Other / unknown');
});

test('platform derivation recognises Steam Deck, Windows, Linux and macOS from os, cpu and gpu', () => {
  const cases: [string, string, string, string][] = [
    ['Steam OS', 'Steam Deck', 'Steam Deck', 'steam-deck'],
    ['SteamOS 3.7', 'AMD Custom APU 0405', 'AMD Custom GPU 0405 (RADV VANGOGH)', 'steam-deck'],
    ['SteamOS', 'AMD Custom APU 0932', 'Unknown', 'steam-deck'],
    ['Bazzite', 'AMD Custom APU 0932', 'AMD Custom GPU 0932 (RADV VANGOGH)', 'steam-deck'],
    ['Windows 11', 'AMD Custom APU 0405', 'AMD Custom GPU 0405', 'steam-deck'],
    ['SteamOS', 'AMD Ryzen 7 5700G with Radeon Graphics', 'AMD Radeon RX 7600 (RADV NAVI33)', 'linux'],
    ['Windows 11 Version 26H2', 'AMD Ryzen 7 9700X 8-Core Processor', 'NVIDIA GeForce RTX 5070 Ti', 'windows'],
    ['Win 11 Pro', '12900k', '3090ti', 'windows'], ['windows 11', '7600x', '5070 ti', 'windows'], ['Windows', 'AMD Ryzen 7 9800X3D', 'Nvidia GeForce RTX 5070', 'windows'],
    ['Windows 10 Version 22H2 (Build 19045.7725)', 'Intel(R) Core(TM) i9-7980XE CPU @ 2.60GHz', 'Intel(R) Arc(TM) A770 Graphics', 'windows'],
    ['CachyOS', 'AMD Ryzen 7 9800X3D 8-Core Processor', 'AMD Radeon RX 9070 XT (RADV GFX1201)', 'linux'],
    ['Fedora Linux 45 (COSMIC)', 'AMD Ryzen 5 5600X', 'Intel Arc B580', 'linux'], ['Linux', 'RX 6600', 'I3-10100F', 'linux'],
    ['Ubuntu 24.04', 'Intel Core i5', 'Mesa Intel(R) UHD Graphics', 'linux'], ['Unknown', 'Unknown', 'AMD Radeon RX 6600 (RADV NAVI23)', 'linux'],
    ['macOS', 'Apple M3 Max', 'Apple M3 Max', 'macos'], ['macOS Golden Gate (27.3)', 'Unknown', 'Apple M4 Pro', 'macos'], ['Unknown', 'Apple M2', 'Apple M2', 'macos'],
    ['Unknown', 'Unknown', 'Unknown', 'other'], ['Android 15', 'Snapdragon 8 Elite', 'Adreno 830', 'other'],
  ];
  for (const [os, cpu, gpu, platform] of cases) assert.equal(derivePlatform({ os, cpu, gpu }), platform, `${os} | ${cpu} | ${gpu}`);
});

test('GPU families, OS labels and setup summaries come from the typed report fields', () => {
  for (const [gpu, family] of [
    ['NVIDIA GeForce RTX 5070 Ti', 'RTX 50'], ['NVIDIA GeForce RTX 4060', 'RTX 40'], ['NVIDIA GeForce RTX 3060 Laptop GPU', 'RTX 30'], ['NVIDIA 3060 TI', 'RTX 30'],
    ['3090ti', 'RTX 30'], ['5070 ti', 'RTX 50'], ['NVIDIA GeForce GTX 1060 6GB', 'GTX 10'], ['NVIDIA Geforce GTX 1650', 'GTX 16'],
    ['AMD Radeon RX 9070 XT (RADV GFX1201)', 'RX 9000'], ['AMD Radeon RX 7900 XTX', 'RX 7000'], ['Radeon RX 570 Series (8GB)', 'RX 500'], ['9070xt', 'RX 9000'], ['6700XT 12GB', 'RX 6000'],
    ['Intel(R) Arc(TM) B580 Graphics', 'Intel Arc'], ['AMD Radeon 780M Graphics', 'Radeon 780M'], ['Apple M4 Pro', 'Apple M4'], ['Steam Deck', 'Steam Deck'], ['AMD Custom GPU 0405', 'Steam Deck'],
  ] as const) assert.equal(gpuFamily(gpu), family, gpu);
  for (const gpu of ['Unknown', 'I3-10100F', 'Test GPU']) assert.equal(gpuFamily(gpu), null, gpu);
  assert.equal(osLabel('Windows 11 Version 26H2', 'windows'), 'Win 11');
  assert.equal(osLabel('Windows', 'windows'), 'Windows');
  assert.equal(osLabel('Steam OS', 'steam-deck'), 'SteamOS');
  assert.equal(osLabel('CachyOS', 'linux'), 'Linux');
  assert.equal(setupSummary({ os: 'Windows 11 Version 26H2', cpu: 'AMD Ryzen 7 9700X', gpu: 'NVIDIA GeForce RTX 4070', graphicsApi: 'Vulkan' }), 'RTX 40 · Vulkan · Win 11');
  assert.equal(setupSummary({ os: 'CachyOS', cpu: 'Ryzen', gpu: 'AMD Radeon RX 7800 XT (RADV NAVI32)', graphicsApi: 'Unknown' }), 'RX 7000 · Linux');
  assert.equal(setupSummary({ os: 'Steam OS', cpu: 'Steam Deck', gpu: 'Steam Deck', graphicsApi: 'Vulkan' }), 'Steam Deck · Vulkan · SteamOS');
  assert.equal(setupSummary({ os: 'Linux test', cpu: 'Test CPU', gpu: 'Test GPU', graphicsApi: 'OpenGL' }), 'Test GPU · OpenGL · Linux');
  assert.equal(setupSummary({ os: 'Unknown', cpu: 'Unknown', gpu: 'Unknown', graphicsApi: 'Unknown' }), '');
});

test('median uses the ordinal rating scale and takes the lower middle value for even counts', () => {
  assert.equal(medianOutcome([]), null);
  assert.equal(medianOutcome(['Runs']), 'Runs');
  assert.equal(medianOutcome(['Perfect', 'Unplayable', 'Runs']), 'Runs');
  assert.equal(medianOutcome(['Perfect', 'Loads']), 'Loads');
  assert.equal(medianOutcome(['Perfect', 'Playable', 'Playable', 'Unplayable']), 'Playable');
  assert.equal(medianOutcome(['Perfect', 'Perfect', 'Loads', 'Runs', 'Unplayable']), 'Runs');
});

test('playable share counts Playable and Perfect reports only', () => {
  const result = tally(['Perfect', 'Playable', 'Runs', 'Loads', 'Unplayable', 'Playable', 'Runs']);
  assert.deepEqual(result.counts, { Perfect: 1, Playable: 2, Runs: 2, Loads: 1, Unplayable: 1 });
  assert.equal(result.total, 7); assert.equal(result.playable, 3); assert.equal(result.median, 'Runs');
  assert.equal(playablePercent(result), 43);
  assert.equal(playablePercent(tally([])), 0);
  assert.deepEqual(tally([]), { total: 0, counts: { Perfect: 0, Playable: 0, Runs: 0, Loads: 0, Unplayable: 0 }, playable: 0, median: null });
});
