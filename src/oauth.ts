import { KeycastHttpSigner } from './keycast-http-signer';
import type { NostrSigner } from './types';

export interface OAuthStorage {
  savePkceState(state: { codeVerifier: string; nonce: string }): void;
  loadPkceState(): { codeVerifier: string; nonce: string } | null;
  clearPkceState(): void;
  saveAuthorizationHandle(handle: string): void;
  loadAuthorizationHandle(): string | null;
  clearAuthorizationHandle(): void;
}

export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
  apiUrl?: string;
  scope?: string;
  storage: OAuthStorage;
  fetchImpl?: typeof fetch;
}

export interface OAuthResult {
  signer: NostrSigner;
  accessToken: string;
  refreshToken?: string;
}

// ── PKCE helpers ──────────────────────────────────────────────

function base64URLEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64URLEncode(bytes.buffer);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64URLEncode(hash);
}

// ── Step 1: Build OAuth URL ─────────────────────────────────

export async function buildOAuthUrl(
  config: OAuthConfig,
  options?: { defaultRegister?: boolean },
): Promise<string> {
  const apiUrl = config.apiUrl ?? 'https://login.divine.video';
  const scope = config.scope ?? 'policy:full';

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const nonce = generateCodeVerifier().substring(0, 16);

  config.storage.savePkceState({ codeVerifier, nonce });

  const url = new URL('/api/oauth/authorize', apiUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', nonce);

  if (options?.defaultRegister) {
    url.searchParams.set('default_register', 'true');
  }

  const handle = config.storage.loadAuthorizationHandle();
  if (handle) {
    url.searchParams.set('authorization_handle', handle);
  }

  return url.toString();
}

// ── Step 2: Exchange code for access token ───────────────────

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  authorization_handle?: string;
}

export async function exchangeCode(
  code: string,
  state: string,
  config: OAuthConfig,
): Promise<OAuthResult> {
  const apiUrl = config.apiUrl ?? 'https://login.divine.video';
  const fetchFn = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const storedState = config.storage.loadPkceState();
  if (!storedState) {
    throw new Error('OAuth session expired. Please try again.');
  }

  if (state !== storedState.nonce) {
    throw new Error('OAuth state mismatch. Please try again.');
  }

  const res = await fetchFn(`${apiUrl}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code_verifier: storedState.codeVerifier,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = body?.error_description ?? body?.error ?? `HTTP ${res.status}`;
    throw new Error(`diVine token exchange failed: ${msg}`);
  }

  const data = (await res.json()) as TokenResponse;

  config.storage.clearPkceState();

  if (!data.access_token) {
    throw new Error('diVine token exchange failed: no access_token in response');
  }

  if (data.authorization_handle) {
    config.storage.saveAuthorizationHandle(data.authorization_handle);
  }

  return {
    signer: new KeycastHttpSigner(data.access_token, {
      refreshToken: data.refresh_token,
      clientId: config.clientId,
      apiUrl,
    }),
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}
