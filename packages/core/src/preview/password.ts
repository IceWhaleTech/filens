export type PreviewPasswordErrorCode = 'password_required' | 'password_invalid' | 'password_cancelled';

export class PreviewPasswordError extends Error {
  constructor(readonly code: PreviewPasswordErrorCode) {
    super(code === 'password_required' ? 'This document requires a password.'
      : code === 'password_invalid' ? 'Incorrect password. Please try again.'
      : 'Opening the document was cancelled.');
    this.name = 'PreviewPasswordError';
  }
}

/** Converter errors carry their stable code in the result contract. */
export function previewPasswordErrorCode(error: unknown): PreviewPasswordErrorCode | undefined {
  const value = error as { code?: unknown; result?: { errorCode?: unknown } } | null;
  const code = value?.code ?? value?.result?.errorCode;
  return code === 'password_required' || code === 'password_invalid' || code === 'password_cancelled' ? code : undefined;
}
