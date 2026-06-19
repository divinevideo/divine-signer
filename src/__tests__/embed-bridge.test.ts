import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  installDivineEmbedBridge,
  isDivineEmbedded,
  getDivineParentOrigin,
  DEFAULT_ALLOWED_PARENT_HOSTS,
  DEFAULT_ALLOWED_PARENT_SUFFIXES,
} from '../embed-bridge';

// Build a sandboxed `window` with the minimum surface the bridge needs and
// install it as the module-global `window` for the duration of one test.
type Listener = (event: MessageEvent) => void;

interface FakeWindow {
  parent: unknown;
  addEventListener: (type: string, listener: Listener) => void;
  postedMessages: Array<{ message: unknown; targetOrigin: string }>;
  messageListener?: Listener;
  nostr?: {
    getPublicKey: () => Promise<string>;
    signEvent: (event: unknown) => Promise<unknown>;
    getRelays: () => Promise<unknown>;
    nip04: {
      encrypt: (pubkey: string, plaintext: string) => Promise<string>;
      decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
    };
    nip44: {
      encrypt: (pubkey: string, plaintext: string) => Promise<string>;
      decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
    };
  };
  __divineEmbedded?: boolean;
  __divineParentOrigin?: string;
}

interface SandboxOptions {
  framed: boolean;
  referrer: string;
}

function setupSandbox(opts: SandboxOptions): FakeWindow {
  const win: FakeWindow = {
    parent: undefined,
    postedMessages: [],
    addEventListener(type, listener) {
      if (type === 'message') win.messageListener = listener;
    },
  };
  win.parent = opts.framed
    ? {
        postMessage: (message: unknown, targetOrigin: string) => {
          win.postedMessages.push({ message, targetOrigin });
        },
      }
    : win;

  // Replace globals for the test.
  (globalThis as unknown as { window: FakeWindow }).window = win;
  (globalThis as unknown as { document: { referrer: string } }).document = {
    referrer: opts.referrer,
  };

  return win;
}

function clearSandbox() {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
}

describe('installDivineEmbedBridge', () => {
  beforeEach(clearSandbox);
  afterEach(clearSandbox);

  describe('install gating', () => {
    it('returns false when running outside a browser (no window)', () => {
      expect(installDivineEmbedBridge()).toBe(false);
    });

    it('returns false on a top-level page (window.parent === window)', () => {
      const win = setupSandbox({ framed: false, referrer: 'https://divine.video/' });
      expect(installDivineEmbedBridge()).toBe(false);
      expect(win.nostr).toBeUndefined();
      expect(win.__divineEmbedded).toBeUndefined();
    });

    it('returns false when document.referrer is empty', () => {
      const win = setupSandbox({ framed: true, referrer: '' });
      expect(installDivineEmbedBridge()).toBe(false);
      expect(win.nostr).toBeUndefined();
    });

    it('returns false for a non-allowlisted parent origin', () => {
      const win = setupSandbox({ framed: true, referrer: 'https://evil.example.com/' });
      expect(installDivineEmbedBridge()).toBe(false);
      expect(win.nostr).toBeUndefined();
    });

    it('returns false for a malformed referrer', () => {
      const win = setupSandbox({ framed: true, referrer: 'not-a-url' });
      expect(installDivineEmbedBridge()).toBe(false);
      expect(win.nostr).toBeUndefined();
    });

    it('installs for divine.video', () => {
      const win = setupSandbox({ framed: true, referrer: 'https://divine.video/edit-profile' });
      expect(installDivineEmbedBridge()).toBe(true);
      expect(win.nostr).toBeDefined();
      expect(win.__divineEmbedded).toBe(true);
      expect(win.__divineParentOrigin).toBe('https://divine.video');
      expect(isDivineEmbedded()).toBe(true);
      expect(getDivineParentOrigin()).toBe('https://divine.video');
    });

    it('installs for *.divine.video subdomain referrer', () => {
      const win = setupSandbox({
        framed: true,
        referrer: 'https://staging.divine.video/edit-profile',
      });
      expect(installDivineEmbedBridge()).toBe(true);
      expect(win.__divineParentOrigin).toBe('https://staging.divine.video');
    });

    it('installs for Cloudflare Pages preview referrer (*.pages.dev)', () => {
      const win = setupSandbox({
        framed: true,
        referrer: 'https://abcd1234.divine-mobile.pages.dev/edit-profile',
      });
      expect(installDivineEmbedBridge()).toBe(true);
      expect(win.__divineParentOrigin).toBe('https://abcd1234.divine-mobile.pages.dev');
    });

    it('does not install for unrelated Cloudflare Pages preview referrers', () => {
      const win = setupSandbox({
        framed: true,
        referrer: 'https://unrelated.pages.dev/edit-profile',
      });
      expect(installDivineEmbedBridge()).toBe(false);
      expect(win.nostr).toBeUndefined();
    });

    it('installs for localhost referrer (dev)', () => {
      const win = setupSandbox({ framed: true, referrer: 'http://localhost:5173/edit-profile' });
      expect(installDivineEmbedBridge()).toBe(true);
      expect(win.__divineParentOrigin).toBe('http://localhost:5173');
    });

    it('is idempotent — second call is a no-op when already installed', () => {
      const win = setupSandbox({ framed: true, referrer: 'https://divine.video/' });
      expect(installDivineEmbedBridge()).toBe(true);
      const firstNostr = win.nostr;
      expect(installDivineEmbedBridge()).toBe(true);
      expect(win.nostr).toBe(firstNostr);
    });

    it('respects custom allowedHosts override', () => {
      const win = setupSandbox({ framed: true, referrer: 'https://my-app.example.com/' });
      expect(
        installDivineEmbedBridge({ allowedHosts: ['my-app.example.com'] }),
      ).toBe(true);
      expect(win.__divineParentOrigin).toBe('https://my-app.example.com');
    });

    it('respects custom allowedSuffixes override', () => {
      const win = setupSandbox({ framed: true, referrer: 'https://x.staging.example.com/' });
      expect(
        installDivineEmbedBridge({ allowedSuffixes: ['.staging.example.com'] }),
      ).toBe(true);
      expect(win.__divineParentOrigin).toBe('https://x.staging.example.com');
    });
  });

  describe('postMessage protocol', () => {
    function setupInstalled() {
      const win = setupSandbox({ framed: true, referrer: 'https://divine.video/' });
      installDivineEmbedBridge();
      return win;
    }

    it('signEvent posts a divine:nostr.request and resolves on matching response', async () => {
      const win = setupInstalled();
      const unsigned = { kind: 0, content: '{}', tags: [], created_at: 0 };
      const signed = { ...unsigned, id: 'x'.repeat(64), sig: 's'.repeat(128), pubkey: 'a'.repeat(64) };

      const promise = win.nostr!.signEvent(unsigned);

      expect(win.postedMessages).toHaveLength(1);
      const posted = win.postedMessages[0];
      expect(posted.targetOrigin).toBe('https://divine.video');
      expect(posted.message).toMatchObject({
        type: 'divine:nostr.request',
        method: 'signEvent',
        params: { event: unsigned },
      });
      const id = (posted.message as { id: number }).id;

      win.messageListener!({
        origin: 'https://divine.video',
        data: { type: 'divine:nostr.response', id, result: signed },
      } as unknown as MessageEvent);

      await expect(promise).resolves.toEqual(signed);
    });

    it('rejects when the parent replies with an error', async () => {
      const win = setupInstalled();
      const promise = win.nostr!.signEvent({ kind: 0 });
      const id = (win.postedMessages[0].message as { id: number }).id;
      win.messageListener!({
        origin: 'https://divine.video',
        data: { type: 'divine:nostr.response', id, error: 'user rejected' },
      } as unknown as MessageEvent);
      await expect(promise).rejects.toThrow('user rejected');
    });

    it('clears the request timeout when a response settles the request', async () => {
      vi.useFakeTimers();
      try {
        const win = setupSandbox({ framed: true, referrer: 'https://divine.video/' });
        installDivineEmbedBridge({ requestTimeoutMs: 100 });
        const promise = win.nostr!.getPublicKey();
        const id = (win.postedMessages[0].message as { id: number }).id;
        expect(vi.getTimerCount()).toBe(1);
        win.messageListener!({
          origin: 'https://divine.video',
          data: { type: 'divine:nostr.response', id, result: 'pubkey' },
        } as unknown as MessageEvent);
        await expect(promise).resolves.toBe('pubkey');
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores responses from a different origin', async () => {
      vi.useFakeTimers();
      try {
        const win = setupSandbox({ framed: true, referrer: 'https://divine.video/' });
        installDivineEmbedBridge({ requestTimeoutMs: 100 });
        const promise = win.nostr!.signEvent({ kind: 0 });
        const id = (win.postedMessages[0].message as { id: number }).id;
        win.messageListener!({
          origin: 'https://evil.example.com',
          data: { type: 'divine:nostr.response', id, result: { sneaky: true } },
        } as unknown as MessageEvent);
        vi.advanceTimersByTime(101);
        await expect(promise).rejects.toThrow('divine.video parent did not respond');
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores responses with a mismatched correlation id', async () => {
      vi.useFakeTimers();
      try {
        const win = setupSandbox({ framed: true, referrer: 'https://divine.video/' });
        installDivineEmbedBridge({ requestTimeoutMs: 100 });
        const promise = win.nostr!.signEvent({ kind: 0 });
        const id = (win.postedMessages[0].message as { id: number }).id;
        win.messageListener!({
          origin: 'https://divine.video',
          data: { type: 'divine:nostr.response', id: id + 999, result: { stale: true } },
        } as unknown as MessageEvent);
        vi.advanceTimersByTime(101);
        await expect(promise).rejects.toThrow('divine.video parent did not respond');
      } finally {
        vi.useRealTimers();
      }
    });

    it('getPublicKey posts a getPublicKey request and returns the pubkey', async () => {
      const win = setupInstalled();
      const promise = win.nostr!.getPublicKey();
      const posted = win.postedMessages[0].message as { method: string; id: number };
      expect(posted.method).toBe('getPublicKey');
      win.messageListener!({
        origin: 'https://divine.video',
        data: { type: 'divine:nostr.response', id: posted.id, result: 'b'.repeat(64) },
      } as unknown as MessageEvent);
      await expect(promise).resolves.toBe('b'.repeat(64));
    });

    it('correlates concurrent requests by id', async () => {
      const win = setupInstalled();
      const pubkeyPromise = win.nostr!.getPublicKey();
      const signPromise = win.nostr!.signEvent({ kind: 0 });
      const id1 = (win.postedMessages[0].message as { id: number }).id;
      const id2 = (win.postedMessages[1].message as { id: number }).id;
      expect(id1).not.toBe(id2);
      win.messageListener!({
        origin: 'https://divine.video',
        data: { type: 'divine:nostr.response', id: id2, result: { signed: true } },
      } as unknown as MessageEvent);
      win.messageListener!({
        origin: 'https://divine.video',
        data: { type: 'divine:nostr.response', id: id1, result: 'pubkey' },
      } as unknown as MessageEvent);
      await expect(pubkeyPromise).resolves.toBe('pubkey');
      await expect(signPromise).resolves.toEqual({ signed: true });
    });

    it('nip04 encrypt and decrypt forward to the parent signer', async () => {
      const win = setupInstalled();
      const encryptPromise = win.nostr!.nip04.encrypt('pub123', 'hello');
      const encryptRequest = win.postedMessages[0].message as {
        method: string;
        id: number;
        params: unknown;
      };
      expect(encryptRequest).toMatchObject({
        method: 'nip04.encrypt',
        params: { pubkey: 'pub123', plaintext: 'hello' },
      });
      win.messageListener!({
        origin: 'https://divine.video',
        data: { type: 'divine:nostr.response', id: encryptRequest.id, result: 'encrypted' },
      } as unknown as MessageEvent);
      await expect(encryptPromise).resolves.toBe('encrypted');

      const decryptPromise = win.nostr!.nip04.decrypt('pub123', 'encrypted');
      const decryptRequest = win.postedMessages[1].message as {
        method: string;
        id: number;
        params: unknown;
      };
      expect(decryptRequest).toMatchObject({
        method: 'nip04.decrypt',
        params: { pubkey: 'pub123', ciphertext: 'encrypted' },
      });
      win.messageListener!({
        origin: 'https://divine.video',
        data: { type: 'divine:nostr.response', id: decryptRequest.id, result: 'hello' },
      } as unknown as MessageEvent);
      await expect(decryptPromise).resolves.toBe('hello');
    });

    it('nip44 encrypt and decrypt forward to the parent signer', async () => {
      const win = setupInstalled();
      const encryptPromise = win.nostr!.nip44.encrypt('pub123', 'hello');
      const encryptRequest = win.postedMessages[0].message as {
        method: string;
        id: number;
        params: unknown;
      };
      expect(encryptRequest).toMatchObject({
        method: 'nip44.encrypt',
        params: { pubkey: 'pub123', plaintext: 'hello' },
      });
      win.messageListener!({
        origin: 'https://divine.video',
        data: { type: 'divine:nostr.response', id: encryptRequest.id, result: 'encrypted' },
      } as unknown as MessageEvent);
      await expect(encryptPromise).resolves.toBe('encrypted');

      const decryptPromise = win.nostr!.nip44.decrypt('pub123', 'encrypted');
      const decryptRequest = win.postedMessages[1].message as {
        method: string;
        id: number;
        params: unknown;
      };
      expect(decryptRequest).toMatchObject({
        method: 'nip44.decrypt',
        params: { pubkey: 'pub123', ciphertext: 'encrypted' },
      });
      win.messageListener!({
        origin: 'https://divine.video',
        data: { type: 'divine:nostr.response', id: decryptRequest.id, result: 'hello' },
      } as unknown as MessageEvent);
      await expect(decryptPromise).resolves.toBe('hello');
    });
  });

  describe('exports', () => {
    it('exposes the default host allowlist', () => {
      expect(DEFAULT_ALLOWED_PARENT_HOSTS).toContain('divine.video');
    });
    it('exposes the default suffix allowlist', () => {
      expect(DEFAULT_ALLOWED_PARENT_SUFFIXES).toContain('.divine.video');
      expect(DEFAULT_ALLOWED_PARENT_SUFFIXES).toContain('.divine-mobile.pages.dev');
    });
  });

  describe('helpers when not embedded', () => {
    it('isDivineEmbedded returns false outside browser', () => {
      expect(isDivineEmbedded()).toBe(false);
    });
    it('getDivineParentOrigin returns null outside browser', () => {
      expect(getDivineParentOrigin()).toBe(null);
    });
  });
});
