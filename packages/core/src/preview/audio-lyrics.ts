export interface AudioLyricLine {
  /** Playback position in seconds, including the LRC offset. */
  time: number;
  text: string;
}

export interface AudioLyrics {
  title?: string;
  artist?: string;
  album?: string;
  lines: AudioLyricLine[];
}

/** Parse simple/enhanced LRC, repeated timestamps, translations and millisecond offsets. */
export function parseAudioLyrics(source: string): AudioLyrics {
  const result: AudioLyrics = { lines: [] };
  let offset = 0;
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const metadata = /^\s*\[(ti|ar|al|offset):([^\]]*)\]\s*$/i.exec(raw);
    if (metadata) {
      const key = metadata[1].toLowerCase();
      const value = metadata[2].trim();
      if (key === 'offset') {
        if (/^[+-]?\d+$/.test(value) && Number.isFinite(Number(value))) offset = Number(value) / 1000;
      } else {
        result[key === 'ti' ? 'title' : key === 'ar' ? 'artist' : 'album'] = value;
      }
      continue;
    }

    const times: number[] = [];
    let text = raw.trimStart();
    let match: RegExpExecArray | null;
    while ((match = /^\[(\d{1,5}):([0-5]\d)(?:[.:](\d{1,3}))?\]/.exec(text))) {
      times.push(Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] ?? '0'}`));
      text = text.slice(match[0].length);
    }
    text = text.replace(/<\d{1,5}:[0-5]\d(?:[.:]\d{1,3})?>/g, '').trim();
    for (const time of times) result.lines.push({ time, text });
  }

  result.lines.sort((a, b) => a.time - b.time);
  const merged: AudioLyricLine[] = [];
  for (const line of result.lines) {
    const previous = merged[merged.length - 1];
    const time = line.time - offset;
    if (previous?.time === time) {
      if (line.text && !previous.text.split('\n').includes(line.text)) {
        previous.text = [previous.text, line.text].filter(Boolean).join('\n');
      }
    } else {
      merged.push({ time, text: line.text });
    }
  }
  result.lines = merged;
  return result;
}

/** Last lyric at or before the playback position; -1 during the intro. */
export function findAudioLyricIndex(lines: AudioLyricLine[], time: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}
