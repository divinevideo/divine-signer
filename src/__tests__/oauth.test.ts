import { exchangeCode, buildOAuthUrl } from '../oauth';
import type { OAuthStorage, OAuthConfig } from '../oauth';
import { KeycastHttpSigner } from '../keycast-http-signer';

function createMockStorage(): OAuthStorage & { _pkce: Record<string, string>; _handle: string | null } {
  const store: Record<string, string> = {};
  return {
    _pkce: store,
    _handle: null,
    savePkceState(state) { store['pkce'] = JSON.stringify(state); },
    loadPkceState() {
      const v = store['pkce'];
      if (!v) return null;
      try { return JSON.parse(v); } catch { return null; }
    },
    clearPkceState() { delete store['pkce']; },
    saveAuthorizationHandle(h) { this._handle = h; },
    loadAuthorizationHandle() { return this._handle; },
    clearAuthorizationHandle() { this._handle = null; },
  };
}

function makeConfig(overrides?: Partial<OAuthConfig> & { storage?: OAuthStorage }): OAuthConfig {
  return {
    clientId: 'privdm',
    redirectUri: 'http://localhost:5173/auth/callback',
    storage: createMockStorage(),
    ...overrides,
  };
}

function setPkceState(config: OAuthConfig, nonce: string, codeVerifier = 'test-verifier') {
  config.storage.savePkceState({ codeVerifier, nonce });
}

describe('buildOAuthUrl', () => {
  it('returns a URL with PKCE params and saves state', async () => {
    const config = makeConfig();
    const url = await buildOAuthUrl(config);

    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://login.divine.video');
    expect(parsed.pathname).toBe('/api/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('privdm');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:5173/auth/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('policy:full');
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBeTruthy();

    // State was saved
    expect(config.storage.loadPkceState()).not.toBeNull();
  });

  it('includes default_register when requested', async () => {
    const config = makeConfig();
    const url = await buildOAuthUrl(config, { defaultRegister: true });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('default_register')).toBe('true');
  });

  it('includes authorization_handle when available', async () => {
    const config = makeConfig();
    config.storage.saveAuthorizationHandle('handle-xyz');
    const url = await buildOAuthUrl(config);

    const parsed = new URL(url);
    expect(parsed.searchParams.get('authorization_handle')).toBe('handle-xyz');
  });

  it('uses custom apiUrl', async () => {
    const config = makeConfig({ apiUrl: 'https://custom.auth.server' });
    const url = await buildOAuthUrl(config);

    expect(url).toContain('https://custom.auth.server');
  });
});

describe('exchangeCode', () => {
  it('throws when OAuth state is missing', async () => {
    const config = makeConfig();
    await expect(
      exchangeCode('code', 'state', config),
    ).rejects.toThrow('OAuth session expired');
  });

  it('throws on state mismatch', async () => {
    const config = makeConfig();
    setPkceState(config, 'correct-nonce');

    await expect(
      exchangeCode('code', 'wrong-nonce', config),
    ).rejects.toThrow('OAuth state mismatch');
  });

  it('throws on token exchange HTTP failure', async () => {
    const config = makeConfig({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'Invalid code' }),
      }),
    });
    setPkceState(config, 'nonce');

    await expect(
      exchangeCode('code', 'nonce', config),
    ).rejects.toThrow('diVine token exchange failed: Invalid code');
  });

  it('throws when response has no access_token', async () => {
    const config = makeConfig({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    });
    setPkceState(config, 'nonce');

    await expect(
      exchangeCode('code', 'nonce', config),
    ).rejects.toThrow('no access_token in response');
  });

  it('returns OAuthResult with signer and accessToken', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'jwt-token-123' }),
    });
    const config = makeConfig({ fetchImpl: mockFetch });
    setPkceState(config, 'nonce', 'my-verifier');

    const result = await exchangeCode('auth-code', 'nonce', config);

    expect(result.signer).toBeInstanceOf(KeycastHttpSigner);
    expect(result.signer.type).toBe('keycast');
    expect(result.accessToken).toBe('jwt-token-123');

    // Verify the token exchange request
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://login.divine.video/api/oauth/token');
    const body = JSON.parse(opts.body);
    expect(body.grant_type).toBe('authorization_code');
    expect(body.code).toBe('auth-code');
    expect(body.code_verifier).toBe('my-verifier');
  });

  it('clears PKCE state after successful exchange', async () => {
    const config = makeConfig({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token' }),
      }),
    });
    setPkceState(config, 'nonce');

    await exchangeCode('code', 'nonce', config);

    expect(config.storage.loadPkceState()).toBeNull();
  });

  it('saves authorization_handle when present in response', async () => {
    const config = makeConfig({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'token',
          authorization_handle: 'handle-xyz',
        }),
      }),
    });
    setPkceState(config, 'nonce');

    await exchangeCode('code', 'nonce', config);

    expect(config.storage.loadAuthorizationHandle()).toBe('handle-xyz');
  });

  it('does not save authorization_handle when absent', async () => {
    const config = makeConfig({
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token' }),
      }),
    });
    setPkceState(config, 'nonce');

    await exchangeCode('code', 'nonce', config);

    expect(config.storage.loadAuthorizationHandle()).toBeNull();
  });
});
