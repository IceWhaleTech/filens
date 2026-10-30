import { findAudioLyricIndex, parseAudioLyrics, type AudioLyrics } from './audio-lyrics';
import type { PreviewLoadContext, PreviewOptions, PreviewSource } from './types';

const MAX_LYRICS_BYTES = 2 * 1024 * 1024;
const MAX_COVER_BYTES = 20 * 1024 * 1024;

/** Presentation and companion resources for the native audio element. */
export class AudioPreviewPlayer {
  readonly element = node('section', 'pptxv-audio-player');
  private readonly artwork = node('div', 'pptxv-audio-artwork');
  private readonly title = node('h2', 'pptxv-audio-title');
  private readonly details = node('p', 'pptxv-audio-details');
  private readonly lyricList = node('div', 'pptxv-audio-lyrics');
  private readonly status = node('p', 'pptxv-audio-status');
  private readonly play: HTMLButtonElement;
  private readonly timing: HTMLElement;
  private readonly labels;
  private lyrics: AudioLyrics = { lines: [] };
  private lyricButtons: HTMLButtonElement[] = [];
  private activeLine = -1;
  private delay = 0;
  private lyricsRevision = 0;
  private coverRevision = 0;
  private coverRank = 0;
  private coverUrl: string | null = null;
  private image: HTMLImageElement | null = null;

  constructor(
    private readonly media: HTMLMediaElement,
    private readonly context: PreviewLoadContext,
    private readonly options: PreviewOptions,
    private readonly signal: AbortSignal
  ) {
    const zh = /^zh\b/i.test(document.documentElement.lang);
    this.labels = zh ? {
      now: '正在聆听', play: '播放', pause: '暂停', lyrics: '歌词', importLyrics: '导入 LRC',
      cover: '更换封面', empty: '让每一句，都有回响', hint: '导入 LRC 歌词，随音乐同步显示',
      invalid: '未找到有效的 LRC 时间标签，请检查歌词文件。', failed: '无法读取歌词，请重试。',
      tooLarge: '歌词文件过大（最多 2 MB）。', imageFailed: '无法显示封面，请选择其他图片。',
      coverLarge: '封面文件过大（最多 20 MB）。', repeat: '单曲循环', speed: '播放速度',
      earlier: '歌词提前 0.5 秒', later: '歌词延后 0.5 秒', timing: '歌词偏移', ready: '歌词已载入，点击歌词可跳转',
      unavailable: '暂时无法播放，请使用下方播放控件重试。'
    } : {
      now: 'NOW PLAYING', play: 'Play', pause: 'Pause', lyrics: 'Lyrics', importLyrics: 'Import LRC',
      cover: 'Change cover', empty: 'A little closer to the music', hint: 'Import LRC lyrics to follow along',
      invalid: 'No valid LRC timestamps found. Please check the lyrics file.', failed: 'Unable to read lyrics. Try again.',
      tooLarge: 'Lyrics file is too large (2 MB maximum).', imageFailed: 'Unable to display this cover. Choose another image.',
      coverLarge: 'Cover file is too large (20 MB maximum).', repeat: 'Repeat track', speed: 'Playback speed',
      earlier: 'Lyrics 0.5 seconds earlier', later: 'Lyrics 0.5 seconds later', timing: 'Lyrics offset',
      ready: 'Lyrics loaded. Click a line to seek.', unavailable: 'Unable to play. Try the playback controls below.'
    };
    this.element.setAttribute('aria-label', this.labels.now);
    const body = node('div', 'pptxv-audio-body');
    const album = node('div', 'pptxv-audio-album');
    const placeholder = node('div', 'pptxv-audio-placeholder');
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.append(node('span', '', '♫'));
    this.play = this.button(this.labels.play, '▶', 'pptxv-audio-play', async () => {
      if (!media.paused) media.pause();
      else {
        try { await media.play(); }
        catch { if (!signal.aborted) this.status.textContent = this.labels.unavailable; }
      }
    });
    this.artwork.append(placeholder, this.play);
    const eyebrow = node('p', 'pptxv-audio-eyebrow', this.labels.now);
    album.append(this.artwork, eyebrow, this.title, this.details);
    album.append(this.fileButton(this.labels.cover, 'image/*', 'pptxv-audio-cover-input', async file => {
      if (file.size > MAX_COVER_BYTES) { this.status.textContent = this.labels.coverLarge; return; }
      this.setCover(file, 4);
    }));

    const lyricPanel = node('div', 'pptxv-audio-lyric-panel');
    const lyricHeader = node('div', 'pptxv-audio-lyric-header');
    lyricHeader.append(node('h3', '', this.labels.lyrics), this.fileButton(
      this.labels.importLyrics, '.lrc,text/plain', 'pptxv-audio-lrc-input', async file => {
        const revision = ++this.lyricsRevision;
        try {
          const content = await this.readLyrics(file);
          if (!signal.aborted && revision === this.lyricsRevision) this.setLyrics(content, true);
        } catch (error) {
          if (!signal.aborted && revision === this.lyricsRevision) this.showLyricsError(error);
        }
      }
    ));
    this.lyricList.tabIndex = 0;
    this.lyricList.setAttribute('role', 'region');
    this.lyricList.setAttribute('aria-label', this.labels.lyrics);
    this.status.setAttribute('role', 'status');
    this.timing = node('div', 'pptxv-audio-timing');
    const offset = node('output', '', '0.0s');
    offset.setAttribute('aria-label', this.labels.timing);
    const adjust = (value: number) => {
      this.delay = Math.round((this.delay + value) * 10) / 10;
      offset.textContent = `${this.delay > 0 ? '+' : ''}${this.delay.toFixed(1)}s`;
      this.sync();
    };
    this.timing.append(
      this.button(this.labels.earlier, '−0.5s', '', () => adjust(-0.5)), offset,
      this.button(this.labels.later, '+0.5s', '', () => adjust(0.5))
    );
    this.timing.hidden = true;
    lyricPanel.append(lyricHeader, this.lyricList, this.timing, this.status);
    body.append(album, lyricPanel);

    const footer = node('div', 'pptxv-audio-footer');
    const extras = node('div', 'pptxv-audio-extras');
    const repeat = this.button(this.labels.repeat, '↻', 'pptxv-audio-repeat', () => {
      media.loop = !media.loop;
      repeat.setAttribute('aria-pressed', String(media.loop));
    });
    repeat.setAttribute('aria-pressed', 'false');
    const speed = node('select', 'pptxv-audio-speed');
    speed.setAttribute('aria-label', this.labels.speed);
    for (const rate of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      const option = node('option', '', `${rate}×`);
      option.value = String(rate); option.selected = rate === 1; speed.append(option);
    }
    speed.addEventListener('change', () => { media.playbackRate = Number(speed.value); }, { signal });
    extras.append(repeat, speed);
    footer.append(media, extras);
    this.element.append(body, footer);
    this.updateMetadata();
    this.showEmpty();
    if (options.audio?.lyrics !== undefined) this.setLyrics(options.audio.lyrics);
    if (options.audio?.cover !== undefined) this.setCover(options.audio.cover, 3);
    for (const event of ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'play', 'pause', 'ended']) {
      media.addEventListener(event, () => this.sync(), { signal });
    }
  }

  async loadCompanions(): Promise<void> {
    // Only ask the supplied resolver. Do not guess network URLs or forward signed query strings.
    if (!this.options.resourceResolver) return;
    const name = (this.context.descriptor.name ?? '').replace(/\\/g, '/').split(/[?#]/, 1)[0];
    if (!name) return;
    const base = name.replace(/\.[^/.]+$/, '');
    const directory = base.slice(0, base.lastIndexOf('/') + 1);
    const revision = this.lyricsRevision;
    await Promise.allSettled([
      (async () => {
        if (this.options.audio?.lyrics !== undefined) return;
        const source = await this.resolve([`${base}.lrc`], 'lyrics');
        if (source === undefined || this.signal.aborted || revision !== this.lyricsRevision) return;
        const content = await this.readLyrics(source);
        if (!this.signal.aborted && revision === this.lyricsRevision) this.setLyrics(content);
      })().catch(error => {
        if (!this.signal.aborted && revision === this.lyricsRevision) this.showLyricsError(error);
      }),
      (async () => {
        if (this.options.audio?.cover !== undefined) return;
        const source = await this.resolve([
          `${base}.jpg`, `${base}.png`, `${base}.webp`, `${directory}cover.jpg`,
          `${directory}cover.png`, `${directory}folder.jpg`
        ], 'cover');
        if (source !== undefined && !this.signal.aborted) this.setCover(source, 2);
      })()
    ]);
  }

  setCover(source: PreviewSource, rank = 1): void {
    if (this.signal.aborted || rank < this.coverRank) return;
    this.coverRank = rank;
    const revision = ++this.coverRevision;
    this.revokeCover();
    const image = node('img', 'pptxv-native-audio-cover');
    image.alt = `${this.options.audio?.title ?? this.context.descriptor.name ?? 'Audio'} — cover`;
    image.addEventListener('error', () => {
      if (revision !== this.coverRevision) return;
      this.revokeCover();
      this.coverRank = 0;
      if (rank >= 3) this.status.textContent = this.labels.imageFailed;
    }, { once: true, signal: this.signal });
    if (typeof source === 'string') image.src = source;
    else {
      const blob = source instanceof Blob ? source : new Blob([copyBytes(source)]);
      this.coverUrl = URL.createObjectURL(blob);
      image.src = this.coverUrl;
    }
    this.image = image;
    this.artwork.prepend(image);
  }

  destroy(): void {
    this.revokeCover();
    this.element.remove();
  }

  private revokeCover(): void {
    this.image?.removeAttribute('src');
    this.image?.remove();
    this.image = null;
    if (this.coverUrl) URL.revokeObjectURL(this.coverUrl);
    this.coverUrl = null;
  }

  private updateMetadata(): void {
    const audio = this.options.audio;
    this.title.textContent = audio?.title || this.lyrics.title || this.context.descriptor.name || 'Audio';
    const details = [audio?.artist || this.lyrics.artist, audio?.album || this.lyrics.album].filter(Boolean);
    this.details.textContent = details.join(' · ') || (this.context.route?.sourceFormat ?? this.context.descriptor.extension ?? 'Audio').toUpperCase();
  }

  private setLyrics(content: string, imported = false): void {
    const parsed = parseAudioLyrics(content);
    if (!parsed.lines.some(line => line.text) || parsed.lines.length > 10_000) {
      this.status.textContent = this.labels.invalid;
      return;
    }
    this.lyrics = parsed;
    this.activeLine = -1;
    this.delay = 0;
    this.timing.querySelector('output')!.textContent = '0.0s';
    this.updateMetadata();
    this.lyricButtons = parsed.lines.map(line => {
      const button = this.button('', line.text || '♪', 'pptxv-audio-lyric', () => {
        if (!Number.isFinite(this.media.duration) || this.media.duration <= 0) return;
        this.media.currentTime = Math.min(this.media.duration, Math.max(0, line.time + this.delay));
        this.sync();
      });
      button.dataset.time = String(line.time);
      return button;
    });
    this.lyricList.replaceChildren(...this.lyricButtons);
    this.lyricList.classList.remove('is-empty');
    this.timing.hidden = false;
    this.status.textContent = imported ? this.labels.ready : '';
    this.sync();
  }

  private showEmpty(): void {
    this.lyricList.classList.add('is-empty');
    const icon = node('span', 'pptxv-audio-empty-icon', '≋');
    icon.setAttribute('aria-hidden', 'true');
    this.lyricList.append(icon, node('p', '', this.labels.empty), node('small', '', this.labels.hint));
  }

  private sync(): void {
    this.element.classList.toggle('is-playing', !this.media.paused && !this.media.ended);
    const playing = !this.media.paused && !this.media.ended;
    this.play.textContent = playing ? 'Ⅱ' : '▶';
    this.play.setAttribute('aria-label', playing ? this.labels.pause : this.labels.play);
    this.play.title = playing ? this.labels.pause : this.labels.play;
    const index = findAudioLyricIndex(this.lyrics.lines, this.media.currentTime - this.delay);
    if (index === this.activeLine) return;
    const previous = this.lyricButtons[this.activeLine];
    previous?.classList.remove('is-active');
    previous?.removeAttribute('aria-current');
    this.activeLine = index;
    const current = this.lyricButtons[index];
    if (current) {
      current.classList.add('is-active');
      current.setAttribute('aria-current', 'true');
      const top = current.offsetTop - (this.lyricList.clientHeight - current.clientHeight) / 2;
      const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Scroll only the lyric viewport, leaving the surrounding document in place.
      this.lyricList.scrollTo?.({ top: Math.max(0, top), behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }

  private button(label: string, text: string, className: string, action: () => void): HTMLButtonElement {
    const button = node('button', className, text);
    button.type = 'button';
    if (label) { button.setAttribute('aria-label', label); button.title = label; }
    button.addEventListener('click', action, { signal: this.signal });
    return button;
  }

  private fileButton(label: string, accept: string, className: string, read: (file: File) => Promise<void>): HTMLElement {
    const wrapper = node('span', 'pptxv-audio-file');
    const input = node('input', className);
    input.type = 'file'; input.accept = accept; input.hidden = true;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      const file = input.files?.[0]; input.value = '';
      if (file) void read(file);
    }, { signal: this.signal });
    wrapper.append(this.button(label, label, 'pptxv-audio-import', () => input.click()), input);
    return wrapper;
  }

  private async resolve(names: string[], relation: string): Promise<PreviewSource | undefined> {
    for (const name of names) {
      if (this.signal.aborted) return;
      const resource = await this.options.resourceResolver!({
        family: 'audio', sourceFormat: this.context.route?.sourceFormat ?? this.context.descriptor.extension,
        source: name, name: name.split('/').pop(), relation
      });
      if (resource == null) continue;
      if (typeof resource === 'object' && !(resource instanceof Blob) && !(resource instanceof ArrayBuffer) && !ArrayBuffer.isView(resource)) {
        if (resource.source !== undefined) return resource.source;
      } else return resource as PreviewSource;
    }
  }

  private async readLyrics(source: PreviewSource): Promise<string> {
    let blob: Blob;
    if (typeof source === 'string') {
      const response = await fetch(source, { signal: this.signal });
      if (!response.ok) throw new Error(this.labels.failed);
      if (Number(response.headers.get('Content-Length')) > MAX_LYRICS_BYTES) throw new Error(this.labels.tooLarge);
      blob = await response.blob();
    } else blob = source instanceof Blob ? source : new Blob([copyBytes(source)]);
    if (blob.size > MAX_LYRICS_BYTES) throw new Error(this.labels.tooLarge);
    if (typeof blob.text === 'function') return blob.text();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(this.labels.failed));
      reader.readAsText(blob);
    });
  }

  private showLyricsError(error: unknown): void {
    this.status.textContent = error instanceof Error && error.message === this.labels.tooLarge ? error.message : this.labels.failed;
  }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function copyBytes(source: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const bytes = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
  return new Uint8Array(bytes).buffer;
}
