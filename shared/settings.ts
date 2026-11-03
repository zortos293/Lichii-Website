export type ReportSettings = {
  resolution: string;
  accuracy: string;
  asyncShaders: 'Unknown' | 'true' | 'false';
  other: string;
};

export const emptySettings: ReportSettings = { resolution: 'Unknown', accuracy: 'Unknown', asyncShaders: 'Unknown', other: '' };

export function readSettings(text: string, current: ReportSettings = emptySettings): ReportSettings {
  const settings = { ...current };
  const other: string[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('Graphics backend: ')) continue;
    if (line.startsWith('Resolution: ')) settings.resolution = line.slice('Resolution: '.length);
    else if (line.startsWith('GPU accuracy: ')) settings.accuracy = line.slice('GPU accuracy: '.length);
    else if (line === 'Asynchronous shaders: true') settings.asyncShaders = 'true';
    else if (line === 'Asynchronous shaders: false') settings.asyncShaders = 'false';
    else if (line === 'Asynchronous shaders: Unknown') settings.asyncShaders = 'Unknown';
    else if (line.trim()) other.push(line);
  }
  if (other.length) settings.other = other.join('\n');
  return settings;
}

export function writeSettings(settings: ReportSettings): string {
  return [
    `Resolution: ${settings.resolution}`,
    `GPU accuracy: ${settings.accuracy}`,
    `Asynchronous shaders: ${settings.asyncShaders}`,
    settings.other.trim(),
  ].filter(Boolean).join('\n');
}
