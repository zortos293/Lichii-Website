import type { outcomes } from './domain.ts';

export type Outcome = (typeof outcomes)[number];
export const outcomeOrder: readonly Outcome[] = ['Unplayable', 'Loads', 'Runs', 'Playable', 'Perfect'];
export const outcomeRank = (outcome: Outcome) => outcomeOrder.indexOf(outcome);

export const platforms = ['steam-deck', 'windows', 'linux', 'macos'] as const;
export type Platform = (typeof platforms)[number] | 'other';
export const platformLabels: Record<Platform, string> = { 'steam-deck': 'Steam Deck', windows: 'Windows', linux: 'Linux', macos: 'macOS', other: 'Other' };

type Hardware = { os: string; cpu: string; gpu: string };
const deckHardware = /steam\s*deck|\bvan\s*gogh\b|\bvangogh\b|\baerith\b|\bsephiroth\b|\bcustom\s+(?:apu|gpu)\s+0(?:405|932)\b/i;
const discreteGpu = /\b(?:rtx|gtx|geforce|nvidia|quadro|arc|rx\s*\d{3,4}|radeon\s+(?:rx|pro|vii)|\d{4}\s*(?:xtx?|ti|super|gre))\b/i;
const mac = /\bmac\s*os\b|\bos\s*x\b|\bdarwin\b|\bmacbook|\bapple\s+m\d/i;
const windows = /\bwindows\b|\bwin\s*(?:1[01]|[78])\b|^\s*win\b/i;
const steamOs = /\bsteam\s*os\b/i;
const linux = /\blinux\b|ubuntu|fedora|\barch\b|cachy\s*os|manjaro|\bmint\b|debian|pop!?[_ ]?os|nobara|bazzite|endeavour|suse|gentoo|nixos|\bneon\b|zorin|elementary|chimera|\bvoid\b|garuda|solus|\brhel\b|centos|alpine|\bsteam\s*os\b/i;
const linuxDriver = /\bradv\b|\bmesa\b|llvmpipe/i;

export function derivePlatform({ os, cpu, gpu }: Hardware): Platform {
  if (deckHardware.test(`${os} ${cpu} ${gpu}`)) return 'steam-deck';
  if (steamOs.test(os) && !discreteGpu.test(gpu)) return 'steam-deck';
  if (mac.test(os) || /\bapple\s+m\d/i.test(`${cpu} ${gpu}`)) return 'macos';
  if (windows.test(os)) return 'windows';
  if (linux.test(os) || linuxDriver.test(gpu)) return 'linux';
  return 'other';
}

export function lichiiBuild(raw: string): number | null {
  const text = raw.trim();
  const match = /\bbuild[\s_-]*#?(\d{1,4})\b/i.exec(text) ?? /^(?:lichii\s+)?#?(\d{1,4})$/i.exec(text);
  const build = match ? Number(match[1]) : 0;
  return build > 0 ? build : null;
}
export const buildLabel = (build: number | null) => build === null ? 'Other / unknown' : `Build ${build}`;

export function gpuFamily(gpu: string): string | null {
  const text = gpu.replace(/\([^)]*\)/g, ' ');
  if (deckHardware.test(gpu)) return 'Steam Deck';
  const apple = /\bapple\s+m(\d)/i.exec(text);
  if (apple) return `Apple M${apple[1]}`;
  const rtx = /\brtx\s*-?\s*(\d)\d{3}/i.exec(text);
  if (rtx) return `RTX ${rtx[1]}0`;
  const gtx = /\bgtx\s*-?\s*(\d{3,4})/i.exec(text);
  if (gtx?.[1]) return gtx[1].length === 4 ? `GTX ${gtx[1].slice(0, 2)}` : `GTX ${gtx[1][0]}00`;
  const rx = /\brx\s*-?\s*(\d{3,4})/i.exec(text);
  if (rx?.[1]) return rx[1].length === 4 ? `RX ${rx[1][0]}000` : `RX ${rx[1][0]}00`;
  if (/\barc\b/i.test(text)) return 'Intel Arc';
  const radeonIgpu = /radeon.*?\b(\d{3})m\b/i.exec(text);
  if (radeonIgpu) return `Radeon ${radeonIgpu[1]}M`;
  if (/intel.*\b(?:uhd|iris|hd graphics)/i.test(text)) return 'Intel graphics';
  const amdBare = /\b([5-9])\d{3}\s*(?:xtx?|gre)\b/i.exec(text);
  if (amdBare) return `RX ${amdBare[1]}000`;
  const nvidiaBare = /\b([2-5])0\d{2}\s*(?:ti|super)?\b/i.exec(text);
  if (nvidiaBare && (/nvidia|geforce/i.test(text) || /\d{4}\s*(?:ti|super)\b/i.test(text))) return `RTX ${nvidiaBare[1]}0`;
  return null;
}

export function osLabel(os: string, platform: Platform): string | null {
  if (steamOs.test(os)) return 'SteamOS';
  if (platform === 'windows' || windows.test(os)) {
    const version = /\b(?:windows|win)\s*(1[01]|[78])\b/i.exec(os);
    return version ? `Win ${version[1]}` : 'Windows';
  }
  if (platform === 'macos') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return null;
}

const meaningful = (value: string) => !/^(?:unknown|n\/?a|none|-+|\?+|)$/i.test(value.trim());
export type SetupFields = Hardware & { graphicsApi: string };
export function setupSummary(report: SetupFields): string {
  const platform = derivePlatform(report);
  const gpu = gpuFamily(report.gpu) ?? (meaningful(report.gpu) ? report.gpu.trim().replace(/\s+/g, ' ').slice(0, 28) : null);
  return [gpu, report.graphicsApi === 'Unknown' ? null : report.graphicsApi, osLabel(report.os, platform)].filter(Boolean).join(' · ');
}

export function medianOutcome(values: readonly Outcome[]): Outcome | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => outcomeRank(a) - outcomeRank(b));
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}
export const isPlayable = (outcome: Outcome) => outcome === 'Perfect' || outcome === 'Playable';

export type Tally = { total: number; counts: Record<Outcome, number>; playable: number; median: Outcome | null };
export function tally(values: readonly Outcome[]): Tally {
  const counts: Record<Outcome, number> = { Perfect: 0, Playable: 0, Runs: 0, Loads: 0, Unplayable: 0 };
  for (const value of values) counts[value]++;
  return { total: values.length, counts, playable: counts.Perfect + counts.Playable, median: medianOutcome(values) };
}
export const playablePercent = ({ playable, total }: Pick<Tally, 'playable' | 'total'>) => total ? Math.round(playable / total * 100) : 0;
