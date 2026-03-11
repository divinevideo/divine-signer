import { verifyEvent } from 'nostr-tools/pure';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';
import type { NostrSigner, SignerType } from './types';

export const DEFAULT_KEYCAST_API = 'https://login.divine.video';

export class KeycastAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Keycast auth failed: HTTP ${status}`);
    this.name = 'KeycastAuthError';
    this.status = status;
  }
}

export interface TokenRefreshResult {
  accessToken: string;
  refreshToken: string;
}

export class KeycastHttpSigner implements NostrSigner {
  readonly type: SignerType = 'keycast';
  private token: string;
  private refreshToken: string | null;
  private readonly clientId: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;
  private cachedPubkey: string | null = null;
  private refreshPromise: Promise<void> | null = null;
  onTokenRefresh: ((result: TokenRefreshResult) => void) | null = null;

  constructor(token: string, options?: {
    refreshToken?: string;
    clientId?: string;
    apiUrl?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.token = token;
    this.refreshToken = options?.refreshToken ?? null;
    this.clientId = options?.clientId ?? 'privdm';
    this.apiUrl = options?.apiUrl ?? DEFAULT_KEYCAST_API;
    this.fetchImpl = options?.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  private async tryRefreshToken(): Promise<boolean> {
    if (!this.refreshToken) return false;

    // Coalesce concurrent refresh attempts
    if (this.refreshPromise) {
      await this.refreshPromise;
      return true;
    }

    try {
      this.refreshPromise = this.doRefresh();
      await this.refreshPromise;
      return true;
    } catch (e) {
      console.warn('[keycast] Token refresh failed:', e);
      return false;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<void> {
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
      throw new KeycastAuthError(res.status);
    }

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    if (!data.access_token) throw new Error('No access_token in refresh response');

    this.token = data.access_token;
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.cachedPubkey = null;

    this.onTokenRefresh?.({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? this.refreshToken!,
    });
  }

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const maxRetries = 3;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`${this.apiUrl}/api/nostr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ method, params }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = res.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * 2 ** attempt;
        console.warn(
          `[keycast] Rate limited on ${method}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})` +
          (retryAfter ? `, Retry-After: ${retryAfter}s` : ''),
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if ((res.status === 401 || res.status === 403) && attempt === 0) {
        const refreshed = await this.tryRefreshToken();
        if (refreshed) continue;
        throw new KeycastAuthError(res.status);
      }

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new KeycastAuthError(res.status);
        }
        throw new Error(`Keycast RPC failed: HTTP ${res.status}`);
      }

      const data = (await res.json()) as { result?: unknown; error?: string };
      if (data.error) {
        throw new Error(`Keycast RPC error: ${data.error}`);
      }

      return data.result;
    }
  }

  async getPublicKey(): Promise<string> {
    if (this.cachedPubkey) return this.cachedPubkey;
    const pubkey = (await this.rpc('get_public_key', [])) as string;
    this.cachedPubkey = pubkey;
    return pubkey;
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    // Server expects a full unsigned event with pubkey populated
    const pubkey = await this.getPublicKey();
    const unsigned = { ...event, pubkey };
    // NIP-46: sign_event params must be [JSON.stringify(event)], not [event]
    const result = await this.rpc('sign_event', [JSON.stringify(unsigned)]);
    const signed: VerifiedEvent =
      typeof result === 'string' ? JSON.parse(result) : (result as VerifiedEvent);
    if (!verifyEvent(signed)) {
      throw new Error('Keycast returned an invalid signed event');
    }
    return signed;
  }

  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return (await this.rpc('nip04_encrypt', [pubkey, plaintext])) as string;
  }

  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return (await this.rpc('nip04_decrypt', [pubkey, ciphertext])) as string;
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return (await this.rpc('nip44_encrypt', [pubkey, plaintext])) as string;
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return (await this.rpc('nip44_decrypt', [pubkey, ciphertext])) as string;
  }
}
