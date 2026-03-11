import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure';
import type { EventTemplate } from 'nostr-tools/pure';
import { KeycastHttpSigner, KeycastAuthError } from '../keycast-http-signer';

function mockFetchOk(result: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ result }),
  });
}

function mockFetchRpcError(error: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ error }),
  });
}

function mockFetchHttpError(status: number, headers?: Record<string, string>) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve({}),
  });
}

describe('KeycastHttpSigner', () => {
  const token = 'test-jwt-token';
  const apiUrl = 'https://keycast.test';

  describe('getPublicKey', () => {
    it('returns hex pubkey from RPC', async () => {
      const fetchImpl = mockFetchOk('aabbccdd');
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      const pubkey = await signer.getPublicKey();

      expect(pubkey).toBe('aabbccdd');
      expect(fetchImpl).toHaveBeenCalledWith(`${apiUrl}/api/nostr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ method: 'get_public_key', params: [] }),
        signal: expect.any(AbortSignal),
      });
    });

    it('caches pubkey after first call', async () => {
      const fetchImpl = mockFetchOk('aabbccdd');
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      await signer.getPublicKey();
      await signer.getPublicKey();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe('signEvent', () => {
    it('sends JSON-stringified event with pubkey and returns verified event', async () => {
      const sk = generateSecretKey();
      const template: EventTemplate = { kind: 1, content: 'hello', tags: [], created_at: 1000 };
      const signed = finalizeEvent(template, sk);
      const { id, pubkey, sig, kind, content, tags, created_at } = signed;
      // NIP-46: server returns the signed event as a JSON string
      const serverResponse = JSON.stringify({ id, pubkey, sig, kind, content, tags, created_at });

      // First call returns pubkey, second returns signed event
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: pubkey }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: serverResponse }) });
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      const result = await signer.signEvent(template);
      expect(result.id).toBe(signed.id);
      expect(result.pubkey).toBe(signed.pubkey);
      expect(result.sig).toBe(signed.sig);

      // Second call is sign_event — params[0] must be JSON with pubkey included
      const body = JSON.parse(fetchImpl.mock.calls[1]![1].body);
      expect(body.method).toBe('sign_event');
      const sentEvent = JSON.parse(body.params[0]);
      expect(sentEvent.kind).toBe(1);
      expect(sentEvent.content).toBe('hello');
      expect(sentEvent.pubkey).toBe(pubkey);
    });

    it('handles server returning event as object (non-NIP-46 compat)', async () => {
      const sk = generateSecretKey();
      const template: EventTemplate = { kind: 1, content: 'hello', tags: [], created_at: 1000 };
      const signed = finalizeEvent(template, sk);
      const { id, pubkey, sig, kind, content, tags, created_at } = signed;

      const fetchImpl = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: pubkey }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { id, pubkey, sig, kind, content, tags, created_at } }) });
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      const result = await signer.signEvent(template);
      expect(result.id).toBe(signed.id);
    });

    it('uses cached pubkey for sign_event', async () => {
      const sk = generateSecretKey();
      const template: EventTemplate = { kind: 1, content: 'hello', tags: [], created_at: 1000 };
      const signed = finalizeEvent(template, sk);
      const { id, pubkey, sig, kind, content, tags, created_at } = signed;
      const serverResponse = JSON.stringify({ id, pubkey, sig, kind, content, tags, created_at });

      const fetchImpl = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: pubkey }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: serverResponse }) });
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      // Pre-cache the pubkey
      await signer.getPublicKey();
      await signer.signEvent(template);

      // Only 2 calls total: get_public_key + sign_event (pubkey was cached)
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('rejects if verifyEvent fails', async () => {
      const invalidEvent = {
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        sig: 'c'.repeat(128),
        kind: 1,
        content: '',
        tags: [],
        created_at: 1000,
      };

      const fetchImpl = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: 'b'.repeat(64) }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: JSON.stringify(invalidEvent) }) });
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      await expect(
        signer.signEvent({ kind: 1, content: '', tags: [], created_at: 1000 }),
      ).rejects.toThrow('Keycast returned an invalid signed event');
    });
  });

  describe('nip04Encrypt', () => {
    it('sends pubkey and plaintext, returns ciphertext', async () => {
      const fetchImpl = mockFetchOk('nip04-encrypted');
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      const result = await signer.nip04Encrypt('recipient-pk', 'secret');

      expect(result).toBe('nip04-encrypted');
      const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
      expect(body.method).toBe('nip04_encrypt');
      expect(body.params).toEqual(['recipient-pk', 'secret']);
    });
  });

  describe('nip04Decrypt', () => {
    it('sends pubkey and ciphertext, returns plaintext', async () => {
      const fetchImpl = mockFetchOk('nip04-decrypted');
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      const result = await signer.nip04Decrypt('sender-pk', 'cipher');

      expect(result).toBe('nip04-decrypted');
      const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
      expect(body.method).toBe('nip04_decrypt');
      expect(body.params).toEqual(['sender-pk', 'cipher']);
    });
  });

  describe('nip44Encrypt', () => {
    it('sends pubkey and plaintext, returns ciphertext', async () => {
      const fetchImpl = mockFetchOk('encrypted-payload');
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      const result = await signer.nip44Encrypt('recipient-pk', 'secret message');

      expect(result).toBe('encrypted-payload');
      const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
      expect(body.method).toBe('nip44_encrypt');
      expect(body.params).toEqual(['recipient-pk', 'secret message']);
    });
  });

  describe('nip44Decrypt', () => {
    it('sends pubkey and ciphertext, returns plaintext', async () => {
      const fetchImpl = mockFetchOk('decrypted message');
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      const result = await signer.nip44Decrypt('sender-pk', 'cipher-text');

      expect(result).toBe('decrypted message');
      const body = JSON.parse(fetchImpl.mock.calls[0]![1].body);
      expect(body.method).toBe('nip44_decrypt');
      expect(body.params).toEqual(['sender-pk', 'cipher-text']);
    });
  });

  describe('error handling', () => {
    it('throws KeycastAuthError on 401', async () => {
      const fetchImpl = mockFetchHttpError(401);
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      await expect(signer.getPublicKey()).rejects.toThrow(KeycastAuthError);
      await expect(signer.getPublicKey()).rejects.toThrow('Keycast auth failed: HTTP 401');
    });

    it('throws KeycastAuthError on 403', async () => {
      const fetchImpl = mockFetchHttpError(403);
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      const err = await signer.getPublicKey().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KeycastAuthError);
      expect((err as KeycastAuthError).status).toBe(403);
    });

    it('throws generic error on other HTTP errors', async () => {
      const fetchImpl = mockFetchHttpError(500);
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      await expect(signer.getPublicKey()).rejects.toThrow('Keycast RPC failed: HTTP 500');
    });

    it('throws on RPC error in response', async () => {
      const fetchImpl = mockFetchRpcError('unauthorized');
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      await expect(signer.getPublicKey()).rejects.toThrow('Keycast RPC error: unauthorized');
    });

    it('retries on 429 and succeeds', async () => {
      vi.useFakeTimers();
      try {
        const fetchImpl = vi.fn()
          .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers() })
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: 'pk123' }) });
        const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

        const promise = signer.getPublicKey();
        await vi.runAllTimersAsync();

        expect(await promise).toBe('pk123');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('respects Retry-After header on 429', async () => {
      vi.useFakeTimers();
      try {
        const fetchImpl = vi.fn()
          .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '2' }) })
          .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: 'pk456' }) });
        const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

        const promise = signer.getPublicKey();
        await vi.advanceTimersByTimeAsync(2000);

        expect(await promise).toBe('pk456');
      } finally {
        vi.useRealTimers();
      }
    });

    it('throws after exhausting 429 retries', async () => {
      vi.useFakeTimers();
      try {
        const fetchImpl = mockFetchHttpError(429);
        const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

        let caughtError: unknown;
        const promise = signer.getPublicKey().catch((e) => { caughtError = e; });

        await vi.runAllTimersAsync();
        await promise;

        expect(caughtError).toBeInstanceOf(Error);
        expect((caughtError as Error).message).toBe('Keycast RPC failed: HTTP 429');
        // 1 initial + 3 retries = 4 calls
        expect(fetchImpl).toHaveBeenCalledTimes(4);
      } finally {
        vi.useRealTimers();
      }
    });
    it('passes 30s timeout signal to fetch', async () => {
      const fetchImpl = mockFetchOk('pk');
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      await signer.getPublicKey();

      const options = fetchImpl.mock.calls[0]![1] as { signal: AbortSignal };
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('token refresh', () => {
    it('refreshes token on 401 when refresh token is available', async () => {
      const fetchImpl = vi.fn()
        // First RPC call returns 401
        .mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers() })
        // Refresh token exchange succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'new-token', refresh_token: 'new-refresh' }),
        })
        // Retry RPC call succeeds with new token
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: 'mypubkey' }) });

      const onRefresh = vi.fn();
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl, refreshToken: 'old-refresh' });
      signer.onTokenRefresh = onRefresh;

      const pubkey = await signer.getPublicKey();

      expect(pubkey).toBe('mypubkey');
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(onRefresh).toHaveBeenCalledWith({ accessToken: 'new-token', refreshToken: 'new-refresh' });
    });

    it('throws KeycastAuthError on 401 when no refresh token', async () => {
      const fetchImpl = mockFetchHttpError(401);
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl });

      await expect(signer.getPublicKey()).rejects.toThrow(KeycastAuthError);
    });

    it('throws KeycastAuthError when refresh token exchange fails', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers() })
        .mockResolvedValueOnce({ ok: false, status: 400, headers: new Headers() });

      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl, refreshToken: 'bad-refresh' });

      await expect(signer.getPublicKey()).rejects.toThrow(KeycastAuthError);
    });
  });

  describe('defaults', () => {
    it('uses default API URL when not provided', async () => {
      const fetchImpl = mockFetchOk('pk');
      const signer = new KeycastHttpSigner(token, { fetchImpl });

      await signer.getPublicKey();

      const url = fetchImpl.mock.calls[0]![0];
      expect(url).toBe('https://login.divine.video/api/nostr');
    });

    it('has type keycast', () => {
      const signer = new KeycastHttpSigner(token, { apiUrl, fetchImpl: mockFetchOk('') });
      expect(signer.type).toBe('keycast');
    });
  });
});
