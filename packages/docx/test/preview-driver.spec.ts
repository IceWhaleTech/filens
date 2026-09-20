import { describe, expect, it, vi } from 'vitest';
import { createDocxPreviewDriver, createDocxPreviewRoutes } from '../src';

vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(async (_blob: Blob, container: HTMLElement) => {
    const article = document.createElement('article');
    article.className = 'docx';
    article.textContent = 'Rendered DOCX';
    container.appendChild(article);
  })
}));

describe('DOCX preview driver', () => {
  it('exposes direct DOCX routes and driver support', () => {
    const routes = createDocxPreviewRoutes();
    const docxRoute = routes.find((route) => route.extensions.includes('docx'));
    const driver = createDocxPreviewDriver();

    expect(docxRoute).toMatchObject({
      targetFormat: 'docx',
      family: 'flow',
      driverId: 'docx'
    });
    expect(docxRoute?.conversion).toBeUndefined();
    expect(driver.supports('docx')).toBe(true);
    expect(driver.supports('.DOCX')).toBe(true);
    expect(driver.supports('pdf')).toBe(false);
  });

  it('renders DOCX sources through docx-preview', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createDocxPreviewDriver().createSession(host);
    const renderedStates: unknown[] = [];

    session.on('rendered', (state) => {
      renderedStates.push(state);
    });

    await session.load(new Uint8Array([80, 75, 3, 4]), {
      descriptor: {
        source: new Uint8Array([80, 75, 3, 4]),
        name: 'sample.docx',
        extension: 'docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }
    });

    expect(host.querySelector('.docxv-document .docx')?.textContent).toBe('Rendered DOCX');
    expect(session.getState()).toMatchObject({
      family: 'flow',
      loading: false,
      error: null,
      capabilities: {
        search: true,
        print: true
      }
    });
    expect(renderedStates).toHaveLength(1);

    session.destroy();
    host.remove();
  });
});
