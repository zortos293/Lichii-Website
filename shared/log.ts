import type { ReportFields } from './domain.ts';

export const MAX_LOG_BYTES = 512 * 1024;

export function validateLog(text: string): string | null {
  if (new TextEncoder().encode(text).length > MAX_LOG_BYTES) return 'The log must be 512 KB or smaller. Trim it to the relevant session.';
  if (!text.trim()) return 'The log is empty.';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(text)) return 'Only UTF-8 plain-text logs are accepted. Archives and binary files are not allowed.';
  if (/<\s*(?:!doctype|html|script|svg|iframe|object|embed|body|img|style|link)\b/i.test(text)) return 'HTML and SVG content is not allowed.';
  if (!/^\[\s*\d+\.\d+\]\s+[\w.]+\s+<(?:Info|Warning|Error|Debug|Critical|Trace)>/m.test(text)) return 'This does not look like a Lichii log. Choose eden_log.txt from the Log Folder.';
  return null;
}

export function extractLogFields(text: string): Partial<ReportFields> {
  const fields: Partial<ReportFields> = {};
  const settingLabels = new Map([
    ['Renderer.backend', 'Graphics backend'],
    ['Renderer.resolution_setup', 'Resolution'],
    ['Renderer.gpu_accuracy', 'GPU accuracy'],
    ['Cpu.cpu_accuracy', 'CPU accuracy'],
    ['Renderer.use_asynchronous_shaders', 'Asynchronous shaders'],
    ['Renderer.use_asynchronous_gpu_emulation', 'Asynchronous GPU emulation'],
    ['Renderer.async_presentation', 'Asynchronous presentation'],
    ['Renderer.use_vsync', 'VSync'],
    ['Renderer.scaling_filter', 'Scaling filter'],
    ['Renderer.anti_aliasing', 'Anti-aliasing'],
    ['Renderer.max_anisotropy', 'Anisotropic filtering'],
    ['Renderer.accelerate_astc', 'ASTC decoding'],
    ['Renderer.astc_recompression', 'ASTC recompression'],
    ['Renderer.nvdec_emulation', 'Video decoding'],
    ['Renderer.use_disk_shader_cache', 'Disk shader cache'],
    ['Renderer.frame_gen', 'Frame generation'],
    ['Renderer.frame_pacing_mode', 'Frame pacing'],
    ['System.use_docked_mode', 'Console mode'],
    ['Core.memory_layout_mode', 'Memory layout'],
  ]);
  const settings = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!/^\[\s*\d+\.\d+\]\s+[\w.]+\s+<Info>\s/.test(line)) continue;
    const capture = (source: string, label: string) => {
      const pattern = new RegExp(`\\b${source}:[0-9]+:[A-Za-z0-9_:~]+: ${label}: (.{1,160})$`);
      return line.match(pattern)?.[1]?.trim();
    };
    const build = capture('qt_common\\.cpp', '(?:Lichii|Eden) Version');
    const cpu = capture('qt_common\\.cpp', 'Host CPU');
    const os = capture('qt_common\\.cpp', 'Host OS');
    const ram = capture('qt_common\\.cpp', 'Host RAM');
    const gpu = capture('renderer_vulkan\\.cpp', 'Device');
    const driver = capture('renderer_vulkan\\.cpp', 'Driver');
    const vulkan = capture('renderer_vulkan\\.cpp', 'Vulkan');
    const boot = line.match(/\bmain_window\.cpp:[0-9]+:[A-Za-z0-9_:~]+: Booting game: [0-9A-Fa-f]+ \| .+ \| (.{0,60})$/);
    const setting = line.match(/\bsettings\.cpp:[0-9]+:LogSettings: (?:M-|--) ([A-Za-z0-9_.]+): ([A-Za-z0-9_.+-]{1,60})$/);
    if (setting) {
      const key = setting[1] ?? '';
      const value = setting[2] ?? '';
      const label = settingLabels.get(key);
      if (label) settings.set(label, value);
      if (key === 'Renderer.backend' && (value === 'Vulkan' || value === 'OpenGL')) fields.graphicsApi = value;
    }
    if (build) fields.build = build;
    if (cpu) fields.cpu = cpu;
    if (os) fields.os = os;
    if (ram) fields.ram = ram;
    if (gpu) fields.gpu = gpu;
    if (driver) fields.driver = driver;
    if (vulkan) fields.graphicsApi = 'Vulkan';
    if (boot) {
      const version = boot[1]?.trim();
      if (version) fields.gameVersion = version;
      else delete fields.gameVersion;
    }
  }
  if (settings.size) fields.settings = [...settings].map(([label, value]) => `${label}: ${value}`).join('\n');
  return fields;
}
