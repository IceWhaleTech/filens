const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const EXPIRES_AT_KEY = 'expires_at';
const AUTH_CHANGE_EVENT = 'zima-auth-change';

export interface ZimaAuthBridge {
  access_token?: string;
  accessToken?: string;
  getAccessToken?: () => string | null | undefined;
  isLoggedIn?: () => boolean;
  openLogin?: () => unknown;
  openLoginModal?: () => unknown;
  showLogin?: () => unknown;
  showLoginModal?: () => unknown;
  login?: () => unknown;
}

declare global {
  interface Window {
    ZimaAuth?: ZimaAuthBridge;
    zimaAuth?: ZimaAuthBridge;
    $wujie?: {
      props?: {
        access_token?: string;
        accessToken?: string;
        zimaAuth?: ZimaAuthBridge;
        jump?: (options: { path: string }) => void;
      };
    };
  }
}

function getStorage(): Storage | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

function getBridgeCandidates(): ZimaAuthBridge[] {
  if (typeof window === 'undefined') return [];
  const candidates: Array<ZimaAuthBridge | undefined> = [window.zimaAuth, window.ZimaAuth, window.$wujie?.props?.zimaAuth];
  if (window.parent !== window) {
    try {
      candidates.push(window.parent.zimaAuth, window.parent.ZimaAuth);
    } catch {
      // Cross-origin parents do not expose their properties to embedded apps.
    }
  }
  return candidates.filter((candidate): candidate is ZimaAuthBridge => Boolean(candidate));
}

function getBridgeToken(): string {
  if (typeof window === 'undefined') return '';
  const injectedToken = window.$wujie?.props?.access_token ?? window.$wujie?.props?.accessToken;
  if (injectedToken) return injectedToken;

  for (const bridge of getBridgeCandidates()) {
    try {
      const token = bridge.getAccessToken?.() ?? bridge.access_token ?? bridge.accessToken;
      if (token) return token;
    } catch {
      // A host bridge can disappear while the parent application is reloading.
    }
  }
  return '';
}

function parseExpiry(value: string | null): number | null {
  if (!value) return null;
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue < 1e12 ? numericValue * 1000 : numericValue;
  }
  const parsedValue = Date.parse(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function announceAuthChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT));
}

export function getAccessToken(): string {
  const bridgeToken = getBridgeToken();
  if (bridgeToken) return bridgeToken;
  return getStorage()?.getItem(ACCESS_TOKEN_KEY) ?? '';
}

export function isAuthenticated(): boolean {
  const token = getAccessToken();
  if (!token) return false;

  const expiry = parseExpiry(getStorage()?.getItem(EXPIRES_AT_KEY) ?? null);
  return expiry === null || expiry > Date.now();
}

export function isZimaRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const query = new URLSearchParams(window.location.search);
  if (query.get('zimaAuth') === '0') return false;
  if (query.get('zimaAuth') === '1') return true;

  const hasHostBridge = getBridgeCandidates().length > 0 || Boolean(window.$wujie?.props);
  const isFilensModulePath = window.location.pathname.replace(/\/+$/, '').endsWith('/modules/filens');
  const isProduction = Boolean((import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD);
  return hasHostBridge || (isProduction && isFilensModulePath);
}

export function persistTokens(tokens: {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expires_at?: string | number;
  expiresAt?: string | number;
}): string {
  const token = tokens.access_token ?? tokens.accessToken ?? '';
  const storage = getStorage();
  if (!storage || !token) return token;

  storage.setItem(ACCESS_TOKEN_KEY, token);
  const refreshToken = tokens.refresh_token ?? tokens.refreshToken;
  if (refreshToken) storage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  const expiresAt = tokens.expires_at ?? tokens.expiresAt;
  if (expiresAt !== undefined) storage.setItem(EXPIRES_AT_KEY, String(expiresAt));
  announceAuthChange();
  return token;
}

export function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, EXPIRES_AT_KEY].includes(event.key)) callback();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(AUTH_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(AUTH_CHANGE_EVENT, callback);
  };
}

async function callLoginBridge(bridge: ZimaAuthBridge): Promise<boolean> {
  for (const method of ['openLoginModal', 'showLoginModal', 'openLogin', 'showLogin', 'login'] as const) {
    const handler = bridge[method];
    if (typeof handler !== 'function') continue;
    try {
      const result = await handler.call(bridge);
      if (typeof result === 'string' && result) persistTokens({ access_token: result });
      if (result && typeof result === 'object') {
        const payload = 'data' in result && result.data && typeof result.data === 'object' ? result.data : result;
        persistTokens(payload as Parameters<typeof persistTokens>[0]);
      }
      return true;
    } catch {
      // Try the next host bridge method before falling back to the app modal.
    }
  }
  return false;
}

/** Ask the ZimaOS host to show its login UI when one is available. */
export async function openLogin(): Promise<boolean> {
  for (const bridge of getBridgeCandidates()) {
    if (await callLoginBridge(bridge)) return true;
  }

  if (typeof window !== 'undefined' && window.parent !== window) {
    window.parent.postMessage({ type: 'zima-auth:open-login' }, '*');
  }
  return false;
}

export function getLoginPath(): string {
  return '/logout';
}

export function goToLogin(): void {
  if (typeof window === 'undefined') return;
  const path = getLoginPath();
  const jump = window.$wujie?.props?.jump;
  if (jump) {
    jump({ path });
    return;
  }
  window.location.assign(path);
}

export const zimaAuth = {
  getAccessToken,
  isAuthenticated,
  isZimaRuntime,
  persistTokens,
  subscribe,
  openLogin,
  getLoginPath,
  goToLogin
};

export default zimaAuth;
