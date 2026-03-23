import { verifyEvent } from 'nostr-tools/pure';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';
import { DivineRpc, RpcError } from '@divinevideo/login';
import type { NostrSigner, SignerType } from './types';

export const DEFAULT_OAUTH_API = 'https://login.divine.video';

export class OAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`OAuth signer auth failed: HTTP ${status}`);
    this.name = 'OAuthError';
    this.status = status;
  }
}

export interface TokenRefreshResult {
  accessToken: string;
  refreshToken: string;
}

export class OAuthSigner implements NostrSigner {
  readonly type: SignerType = 'oauth';
  private readonly rpc: DivineRpc;
  private readonly apiUrl: string;
  private readonly clientId: string;
  private readonly fetchImpl: typeof fetch;
  private refreshToken: string | null;
  onTokenRefresh: ((result: TokenRefreshResult) => void) | null = null;

  constructor(token: string, options?: {
    refreshToken?: string;
    clientId?: string;
    apiUrl?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.refreshToken = options?.refreshToken ?? null;
    this.clientId = options?.clientId ?? 'privdm';
    this.apiUrl = options?.apiUrl ?? DEFAULT_OAUTH_API;
    this.fetchImpl = options?.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

    this.rpc = new DivineRpc({
      nostrApi: `${this.apiUrl}/api/nostr`,
      accessToken: token,
      fetch: this.fetchImpl,
      onUnauthorized: this.refreshToken
        ? () => this.doRefresh()
        : undefined,
    });
  }

  private async doRefresh(): Promise<string> {
    const res = await this.fetchImpl(`${this.apiUrl}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      this.refreshToken = null;
      throw new OAuthError(res.status);
    }

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    if (!data.access_token) throw new Error('No access_token in refresh response');

    if (data.refresh_token) this.refreshToken = data.refresh_token;

    this.onTokenRefresh?.({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? this.refreshToken!,
    });

    return data.access_token;
  }

  private wrapRpcError(err: unknown): never {
    if (err instanceof RpcError) {
      if (err.status === 401 || err.status === 403) {
        throw new OAuthError(err.status);
      }
      throw new Error(`OAuth signer RPC failed: HTTP ${err.status}`);
    }
    if (err instanceof Error && !err.message.startsWith('OAuth signer')) {
      throw new Error(`OAuth signer RPC error: ${err.message}`);
    }
    throw err;
  }

  async getPublicKey(): Promise<string> {
    try {
      return await this.rpc.getPublicKey();
    } catch (err) {
      this.wrapRpcError(err);
    }
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    try {
      const pubkey = await this.rpc.getPublicKey();
      const unsigned = { ...event, pubkey };
      const result = await this.rpc.signEvent(unsigned);
      const signed: VerifiedEvent =
        typeof result === 'string' ? JSON.parse(result) : (result as unknown as VerifiedEvent);
      if (!verifyEvent(signed)) {
        throw new Error('OAuth signer returned an invalid signed event');
      }
      return signed;
    } catch (err) {
      if (err instanceof Error && err.message === 'OAuth signer returned an invalid signed event') {
        throw err;
      }
      if (err instanceof RpcError || (err instanceof Error && !err.message.startsWith('OAuth signer'))) {
        this.wrapRpcError(err);
      }
      throw err;
    }
  }

  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    try {
      return await this.rpc.nip04Encrypt(pubkey, plaintext);
    } catch (err) {
      this.wrapRpcError(err);
    }
  }

  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    try {
      return await this.rpc.nip04Decrypt(pubkey, ciphertext);
    } catch (err) {
      this.wrapRpcError(err);
    }
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    try {
      return await this.rpc.nip44Encrypt(pubkey, plaintext);
    } catch (err) {
      this.wrapRpcError(err);
    }
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    try {
      return await this.rpc.nip44Decrypt(pubkey, ciphertext);
    } catch (err) {
      this.wrapRpcError(err);
    }
  }
}
