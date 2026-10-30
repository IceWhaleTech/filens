import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFileSetResourceResolver, createMediaPreviewDriver, findAudioLyricIndex, parseAudioLyrics,
  type PreviewOptions, type PreviewSession, type PreviewSource
} from '../src/preview';

describe('LRC lyrics', () => {
  it('sorts repeated timestamps, merges translations and applies offsets declared at the end', () => {
    const lyrics = parseAudioLyrics('\uFEFF[ti:夜曲]\r\n[ar:Artist]\r\n[al:Album]\r\n' +
      '[00:04.500][00:02.5]Hello\r\n[00:02.500]你好\r\n[00:01]Intro\r\n[offset:500]');
    expect(lyrics).toEqual({ title: '夜曲', artist: 'Artist', album: 'Album', lines: [
      { time: 0.5, text: 'Intro' }, { time: 2, text: 'Hello\n你好' }, { time: 4, text: 'Hello' }
    ] });
    expect(findAudioLyricIndex(lyrics.lines, 0)).toBe(-1);
    expect(findAudioLyricIndex(lyrics.lines, 2)).toBe(1);
    expect(findAudioLyricIndex(lyrics.lines, 1)).toBe(0);
    expect(findAudioLyricIndex(lyrics.lines, 100)).toBe(2);
  });

  it('handles negative offsets, enhanced LRC and blank instrumental lines', () => {
    const { lines } = parseAudioLyrics('[offset:-1000]\n[00:00.12]<00:00.12>Hello <00:00.50>world\n[00:03.001]');
    expect(lines[0]).toEqual({ time: 1.12, text: 'Hello world' });
    expect(lines[1].time).toBeCloseTo(4.001, 6);
    expect(lines[1].text).toBe('');
  });

  it('ignores invalid timestamps and metadata without treating text as HTML', () => {
    expect(parseAudioLyrics('[00:99.00]Invalid\n[bad]Noise\n[by:Author]\n[00:02]<img src=x onerror=alert(1)>').lines)
      .toEqual([{ time: 2, text: '<img src=x onerror=alert(1)>' }]);
    expect(findAudioLyricIndex([], 0)).toBe(-1);
  });
});

const sessions: PreviewSession[] = [];
let urls: Set<string>;
beforeEach(() => {
  urls = new Set();
  let nextUrl = 0;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => { const url = `blob:audio-${nextUrl++}`; urls.add(url); return url; });
    static revokeObjectURL = vi.fn((url: string) => { urls.delete(url); });
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  document.documentElement.lang = 'en';
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.destroy();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

async function setup(options: PreviewOptions = {}, source: PreviewSource = '/song.wav') {
  const host = document.createElement('div'); document.body.append(host);
  const session = createMediaPreviewDriver().createSession(host, options); sessions.push(session);
  await session.load(source, { descriptor: { source, name: 'song.wav', extension: 'wav' } });
  const media = host.querySelector('audio')!;
  Object.defineProperty(media, 'duration', { configurable: true, value: 12 });
  media.dispatchEvent(new Event('loadedmetadata'));
  return { host, session, media };
}

describe('audio player', () => {
  it('displays metadata, tracks seeks in both directions, and renders lyrics safely', async () => {
    const { host, media } = await setup({ audio: { lyrics: '[ti:Song]\n[ar:Artist]\n[00:02]First\n[00:04]<img src=x>' } });
    expect(host.querySelector('h2')?.textContent).toBe('Song');
    expect(host.querySelector('.pptxv-audio-details')?.textContent).toBe('Artist');
    expect(host.querySelector('img')).toBeNull();
    const seek = (time: number) => { media.currentTime = time; media.dispatchEvent(new Event('seeking')); };
    expect(host.querySelector('.is-active')).toBeNull();
    seek(4);
    expect(host.querySelector('.is-active')?.textContent).toBe('<img src=x>');
    seek(2);
    expect(host.querySelector('[aria-current=true]')?.textContent).toBe('First');
    seek(0);
    expect(host.querySelector('[aria-current]')).toBeNull();
    (host.querySelectorAll('.pptxv-audio-lyric')[1] as HTMLButtonElement).click();
    expect(media.currentTime).toBe(4);
    (host.querySelector('[aria-label="Lyrics 0.5 seconds later"]') as HTMLButtonElement).click();
    expect(host.querySelector('[aria-current=true]')?.textContent).toBe('First');
  });

  it('resolves sibling lyrics and cover from an uploaded file set and cleans up on replacement', async () => {
    const options = { resourceResolver: createFileSetResourceResolver([
      new File(['[00:00]Hello\n[00:02]World'], 'song.lrc'), new File(['cover'], 'song.png', { type: 'image/png' })
    ]) };
    const { host, session } = await setup(options, new Uint8Array([1, 2]));
    expect(host.querySelectorAll('.pptxv-audio-lyric')).toHaveLength(2);
    expect(host.querySelector('img')?.src).toMatch(/^blob:audio-/);
    expect(urls.size).toBe(2);
    await session.load('/other.mp4', { descriptor: { source: '/other.mp4', name: 'other.mp4', extension: 'mp4' } });
    expect(host.querySelector('.pptxv-audio-player')).toBeNull();
    expect(urls.size).toBe(0);
  });

  it('keeps explicit artwork and lyrics ahead of companion resources', async () => {
    const resolve = vi.fn(() => ({ source: '/companion.jpg' }));
    const { host } = await setup({ audio: { cover: '/explicit.jpg', lyrics: '[00:00]Explicit' }, resourceResolver: resolve });
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/explicit.jpg');
    expect(host.querySelector('.pptxv-audio-lyric')?.textContent).toBe('Explicit');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not attach late companion lyrics or artwork after destruction', async () => {
    let finish!: (value: { source: Blob }) => void;
    const host = document.createElement('div');
    const session = createMediaPreviewDriver().createSession(host, {
      resourceResolver: ({ relation }) => relation === 'lyrics' ? new Promise(resolve => { finish = resolve; }) : undefined
    });
    const pending = session.load('/song.wav', { descriptor: { source: '/song.wav', name: 'song.wav', extension: 'wav' } });
    session.destroy();
    finish({ source: new Blob(['[00:00]Late']) });
    await pending;
    expect(host.childElementCount).toBe(0);
    expect(urls.size).toBe(0);
  });

  it('does not overwrite user imports when automatic companion reads finish later', async () => {
    let finishLyrics!: (value: { source: Blob }) => void;
    let finishCover!: (value: { source: string }) => void;
    const host = document.createElement('div'); document.body.append(host);
    const session = createMediaPreviewDriver().createSession(host, {
      resourceResolver: ({ relation }) => relation === 'lyrics'
        ? new Promise(resolve => { finishLyrics = resolve; })
        : new Promise(resolve => { finishCover = resolve; })
    });
    sessions.push(session);
    const pending = session.load('/song.wav', { descriptor: { source: '/song.wav', name: 'song.wav', extension: 'wav' } });
    const importFile = (selector: string, file: File) => {
      const input = host.querySelector(selector)!;
      Object.defineProperty(input, 'files', { value: [file] }); input.dispatchEvent(new Event('change'));
    };
    importFile('.pptxv-audio-lrc-input', new File(['[ti:Manual]\n[00:00]User lyrics'], 'manual.lrc'));
    importFile('.pptxv-audio-cover-input', new File(['manual cover'], 'manual.png', { type: 'image/png' }));
    await vi.waitFor(() => expect(host.querySelector('h2')?.textContent).toBe('Manual'));
    const manualCover = host.querySelector('img')!.src;
    finishLyrics({ source: new Blob(['[ti:Automatic]\n[00:00]Automatic lyrics']) });
    finishCover({ source: '/automatic.jpg' });
    await pending;
    expect(host.querySelector('h2')?.textContent).toBe('Manual');
    expect(host.querySelector('.pptxv-audio-lyric')?.textContent).toBe('User lyrics');
    expect(host.querySelector('img')?.src).toBe(manualCover);
  });

  it('keeps audio usable when optional lyrics fail and offers repeat and playback speed', async () => {
    const { host, media, session } = await setup({ resourceResolver: () => { throw new Error('Unavailable'); } });
    expect(host.querySelector('[role=status]')?.textContent).toContain('Unable to read lyrics');
    expect(session.getState().error).toBeNull();
    const repeat = host.querySelector('[aria-label="Repeat track"]') as HTMLButtonElement;
    repeat.click(); expect(media.loop).toBe(true); expect(repeat.getAttribute('aria-pressed')).toBe('true');
    const speed = host.querySelector('select')!;
    speed.value = '1.5'; speed.dispatchEvent(new Event('change'));
    expect(media.playbackRate).toBe(1.5);
  });

  it('falls back to the placeholder and releases a failed cover URL', async () => {
    const { host, session } = await setup({ audio: { cover: new Blob(['bad'], { type: 'image/png' }) } });
    expect(urls.size).toBe(1);
    host.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(urls.size).toBe(0);
    expect(host.querySelector('img')).toBeNull();
    expect(session.getState().error).toBeNull();
  });
});
