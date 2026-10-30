import { expect, test } from '@playwright/test';
import { createWavFixture } from '../../../packages/core/test/fixtures/native-media.mjs';

test('plays the audio showcase with artwork, synced lyrics, seeking and timing controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview&format=wav');
  const player = page.locator('.pptxv-audio-player');
  const audio = player.locator('audio');
  await expect(player.getByRole('heading', { name: '声与光 · Sound & Light' })).toBeVisible();
  await expect.poll(() => player.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => audio.evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(2);
  await player.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => audio.evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
  await expect(player.locator('[aria-current=true]')).toHaveText('按下播放，让声音流动');
  await player.getByRole('button', { name: '暂停', exact: true }).click();
  await player.getByRole('button', { name: '点击任意一句，回到那一刻', exact: true }).click();
  await expect.poll(() => audio.evaluate(audio => audio.currentTime)).toBeCloseTo(4, 1);
  await expect(player.locator('[aria-current=true]')).toHaveText('点击任意一句，回到那一刻');
  await player.getByRole('button', { name: '歌词延后 0.5 秒' }).click();
  await expect(player.locator('[aria-current=true]')).toHaveText('歌词随音乐，逐句亮起');
  await player.getByRole('button', { name: '单曲循环' }).click();
  expect(await audio.evaluate(audio => audio.loop)).toBe(true);
  await player.getByRole('combobox', { name: '播放速度' }).selectOption('1.5');
  expect(await audio.evaluate(audio => audio.playbackRate)).toBe(1.5);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('chooses audio ahead of its uploaded cover, resolves sibling lyrics, and permits lyric replacement', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles([
    { name: 'song.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=', 'base64') },
    { name: 'song.lrc', mimeType: 'text/plain', buffer: Buffer.from('[ti:Local song]\n[ar:Local artist]\n[00:00]First line\n[00:02]Second line') },
    { name: 'song.wav', mimeType: 'audio/wav', buffer: Buffer.from(createWavFixture(96_044)) }
  ]);
  const player = page.locator('.pptxv-audio-player');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('song.wav');
  await expect(player.getByRole('heading', { name: 'Local song' })).toBeVisible();
  await expect.poll(() => player.locator('img').evaluate(image => image.naturalWidth)).toBe(1);
  await player.locator('.pptxv-audio-lrc-input').setInputFiles({
    name: 'replacement.lrc', mimeType: 'text/plain', buffer: Buffer.from('[ti:新歌词]\n[offset:500]\n[00:01]你好\n[00:03]再见')
  });
  await expect(player.getByRole('heading', { name: '新歌词', exact: true })).toBeVisible();
  await expect(player.locator('.pptxv-audio-lyric')).toHaveText(['你好', '再见']);
  await player.locator('.pptxv-audio-lrc-input').setInputFiles({ name: 'invalid.lrc', mimeType: 'text/plain', buffer: Buffer.from('no timestamps') });
  await expect(player.locator('.pptxv-audio-status')).toContainText('未找到有效的 LRC 时间标签');
  await expect(player.locator('.pptxv-audio-lyric')).toHaveText(['你好', '再见']);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);

  await player.locator('.pptxv-audio-lrc-input').setInputFiles({
    name: 'long.lrc', mimeType: 'text/plain',
    buffer: Buffer.from(Array.from({ length: 40 }, (_, i) => `[00:${String(i).padStart(2, '0')}]Lyric ${i}`).join('\n'))
  });
  const pageScroll = await page.evaluate(() => window.scrollY);
  await player.locator('audio').evaluate(audio => { audio.currentTime = 5.5; audio.dispatchEvent(new Event('timeupdate')); });
  await expect(player.locator('[aria-current=true]')).toHaveText('Lyric 5');
  await expect.poll(() => player.locator('.pptxv-audio-lyrics').evaluate(list => {
    const current = list.querySelector('[aria-current=true]')!;
    const a = current.getBoundingClientRect(), b = list.getBoundingClientRect();
    return Math.abs(a.top + a.height / 2 - b.top - b.height / 2);
  })).toBeLessThan(3);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
});

test('keeps the cover, lyrics and native controls usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?view=preview&format=wav');
  const player = page.locator('.pptxv-audio-player');
  await expect(player.getByRole('heading', { name: '声与光 · Sound & Light' })).toBeVisible();
  const layout = await player.evaluate(element => {
    const lyrics = element.querySelector('.pptxv-audio-lyrics')!;
    const album = element.querySelector('.pptxv-audio-album')!;
    return { overflow: element.scrollWidth > element.clientWidth, stacked: lyrics.getBoundingClientRect().top >= album.getBoundingClientRect().bottom };
  });
  expect(layout).toEqual({ overflow: false, stacked: true });
  await player.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => player.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
  await player.getByRole('button', { name: '单曲循环' }).click();
  await expect(player.getByRole('button', { name: '单曲循环' })).toHaveAttribute('aria-pressed', 'true');
  await player.getByRole('combobox', { name: '播放速度' }).selectOption('0.75');
  expect(await player.locator('audio').evaluate(audio => audio.playbackRate)).toBe(0.75);
});
