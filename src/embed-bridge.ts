// Divine integrated-app embed bridge.
//
// When a Divine first-party app (verifyer.divine.video, badges.divine.video,
// etc.) is loaded inside an iframe of a trusted Divine origin, this module
// installs a window.nostr (NIP-07) shim that proxies getPublicKey, signEvent,
// getRelays, nip04, and nip44 calls to the parent frame over postMessage. Apps using
// ExtensionSigner from this package then transparently use the host's signer
// without the user having to log in again inside the iframe.
//
// The host (e.g. divine-mobile Flutter web) must listen for messages of shape:
//   { type: 'divine:nostr.request', id, method, params }
// and reply with:
//   { type: 'divine:nostr.response', id, result }   on success
//   { type: 'divine:nostr.response', id, error }    on failure
//
// Top-level (non-framed) loads are unaffected — the shim is only installed
// when window.parent !== window AND document.referrer host matches the
// allowlist. Apps' existing extension / OAuth / NIP-46-bunker login paths
// continue to work for direct visits.

export const DEFAULT_ALLOWED_PARENT_HOSTS: readonly string[] = [
  'divine.video',
  'app.divine.video',
  'localhost',
];

export const DEFAULT_ALLOWED_PARENT_SUFFIXES: readonly string[] = [
  '.divine.video',
  '.divine-mobile.pages.dev',
];

/** postMessage envelope sent from the iframe to the host. */
export interface EmbedBridgeRequest {
  type: 'divine:nostr.request';
  id: number;
  method:
    | 'getPublicKey'
    | 'signEvent'
    | 'getRelays'
    | 'nip04.encrypt'
    | 'nip04.decrypt'
    | 'nip44.encrypt'
    | 'nip44.decrypt';
  params: Record<string, unknown>;
}

/** postMessage envelope sent from the host back to the iframe. */
export interface EmbedBridgeResponse {
  type: 'divine:nostr.response';
  id: number;
  result?: unknown;
  error?: string;
}

export interface EmbedBridgeOptions {
  /**
   * Exact-match parent hostname allowlist. Defaults to
   * `['divine.video', 'app.divine.video', 'localhost']`.
   */
  allowedHosts?: readonly string[];
  /**
   * Suffix-match parent hostname allowlist. Defaults to
   * `['.divine.video', '.divine-mobile.pages.dev']` so staging and the Divine
   * mobile Cloudflare Pages preview deploys are accepted.
   */
  allowedSuffixes?: readonly string[];
  /**
   * Override the milliseconds before an unanswered request rejects.
   * Defaults to 60s. Useful for tests.
   */
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Install the embed bridge if the page is loaded inside a trusted Divine
 * iframe. Returns `true` when the shim was installed (host detected) and
 * `false` for top-level loads or untrusted parents.
 *
 * Idempotent: calling twice is a no-op on the second call.
 *
 * Side effects when installed:
 * - `window.nostr` is set to a postMessage-proxied NIP-07 shim
 *   (overriding any browser extension that injected one)
 * - `window.__divineEmbedded = true`
 * - `window.__divineParentOrigin = '<host origin>'`
 *
 * Throws nothing — bad referrers, malformed URLs, or top-level loads all
 * resolve to a clean no-op.
 */
export function installDivineEmbedBridge(opts: EmbedBridgeOptions = {}): boolean {
  if (typeof window === 'undefined' || window.parent === window) {
    return false;
  }
  // Idempotent — already installed.
  if ((window as unknown as { __divineEmbedded?: boolean }).__divineEmbedded) {
    return true;
  }

  const allowedHosts = opts.allowedHosts ?? DEFAULT_ALLOWED_PARENT_HOSTS;
  const allowedSuffixes = opts.allowedSuffixes ?? DEFAULT_ALLOWED_PARENT_SUFFIXES;
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  let parentOrigin: string | null = null;
  try {
    if (typeof document !== 'undefined' && document.referrer) {
      const u = new URL(document.referrer);
      if (
        allowedHosts.indexOf(u.hostname) !== -1 ||
        allowedSuffixes.some((s) => u.hostname.endsWith(s))
      ) {
        parentOrigin = u.origin;
      }
    }
  } catch {
    return false;
  }
  if (!parentOrigin) return false;

  // Mark embedded mode for app code that wants to branch on it.
  (window as unknown as Record<string, unknown>).__divineEmbedded = true;
  (window as unknown as Record<string, unknown>).__divineParentOrigin = parentOrigin;

  let nextRequestId = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== parentOrigin) return;
    const data = event.data as EmbedBridgeResponse | undefined;
    if (!data || data.type !== 'divine:nostr.response') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timeoutId);
    if (data.error) entry.reject(new Error(String(data.error)));
    else entry.resolve(data.result);
  });

  function sendRequest<T>(
    method: EmbedBridgeRequest['method'],
    params?: Record<string, unknown>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++nextRequestId;
      const timeoutId = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('divine.video parent did not respond'));
        }
      }, requestTimeoutMs);
      pending.set(id, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timeoutId,
      });
      const message: EmbedBridgeRequest = {
        type: 'divine:nostr.request',
        id,
        method,
        params: params ?? {},
      };
      window.parent.postMessage(message, parentOrigin!);
    });
  }

  Object.defineProperty(window, 'nostr', {
    value: {
      getPublicKey: () => sendRequest<string>('getPublicKey'),
      signEvent: (event: unknown) => sendRequest<unknown>('signEvent', { event }),
      getRelays: () => sendRequest<unknown>('getRelays'),
      nip04: {
        encrypt: (pubkey: string, plaintext: string) =>
          sendRequest<string>('nip04.encrypt', { pubkey, plaintext }),
        decrypt: (pubkey: string, ciphertext: string) =>
          sendRequest<string>('nip04.decrypt', { pubkey, ciphertext }),
      },
      nip44: {
        encrypt: (pubkey: string, plaintext: string) =>
          sendRequest<string>('nip44.encrypt', { pubkey, plaintext }),
        decrypt: (pubkey: string, ciphertext: string) =>
          sendRequest<string>('nip44.decrypt', { pubkey, ciphertext }),
      },
    },
    configurable: true,
    writable: true,
  });

  return true;
}

/** True when {@link installDivineEmbedBridge} has installed the bridge in the current window. */
export function isDivineEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as unknown as { __divineEmbedded?: boolean }).__divineEmbedded === true;
}

/** The trusted parent origin if {@link installDivineEmbedBridge} succeeded, otherwise null. */
export function getDivineParentOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const v = (window as unknown as { __divineParentOrigin?: string }).__divineParentOrigin;
  return typeof v === 'string' ? v : null;
}
