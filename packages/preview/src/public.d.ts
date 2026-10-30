export type PreviewSource = string | ArrayBuffer | Uint8Array | Blob | File;
export interface SourceDescriptor {
  source: PreviewSource;
  name?: string;
  extension?: string;
  contentType?: string;
  size?: number;
  password?: string;
}
export interface BrowserPreviewOptions {
  src: PreviewSource | SourceDescriptor;
  name?: string;
  extension?: string;
  contentType?: string;
  password?: string;
  fit?: 'contain' | 'width' | 'height' | 'none';
  toolbar?: boolean;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  onRendered?: (state: unknown) => void;
  onError?: (error: Error) => void;
  requestPassword?: (request: {
    name?: string;
    reason: 'password_required' | 'password_invalid';
    attempt: number;
    signal?: AbortSignal;
  }) => string | null | Promise<string | null>;
  /** Advanced shared-host options, including converter, fonts, audio and resources. */
  [option: string]: unknown;
}
export interface BrowserPreview {
  update(options: Partial<BrowserPreviewOptions>): void;
  destroy(): void;
}
export declare function createPreview(element: Element | string, options: BrowserPreviewOptions): BrowserPreview;
