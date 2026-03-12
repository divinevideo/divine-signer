import {
  BunkerSigner,
  parseBunkerInput,
  toBunkerURL,
  type BunkerSignerParams,
} from 'nostr-tools/nip46';
import { SimplePool } from 'nostr-tools';
import { getConversationKey, decrypt } from 'nostr-tools/nip44';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';
import type { NostrSigner, SignerType } from './types';

export interface NostrConnectHandle {
  /** Call after showing the QR code. Resolves when the remote signer acks. */
  waitForSigner(): Promise<BunkerNIP44Signer>;
  /** Abort the connection attempt. */
  abort(): void;
}

export class BunkerNIP44Signer implements NostrSigner {
  readonly type: SignerType;
  private readonly inner: BunkerSigner;

  private constructor(inner: BunkerSigner, type: SignerType) {
    this.inner = inner;
    this.type = type;
  }

  /** Connect via a bunker:// URL or NIP-05 identifier. */
  static async fromBunkerUrl(
    input: string,
    params?: BunkerSignerParams,
    overrideType?: SignerType,
    connectTimeout = 30_000,
  ): Promise<BunkerNIP44Signer> {
    const bp = await parseBunkerInput(input);
    if (!bp) {
      throw new Error(`Invalid bunker input: ${input}`);
    }
    const clientKey = generateSecretKey();
    const inner = BunkerSigner.fromBunker(clientKey, bp, params);
    await Promise.race([
      inner.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Bunker connection timed out')), connectTimeout),
      ),
    ]);
    return new BunkerNIP44Signer(inner, overrideType ?? 'bunker');
  }

  /** Reconnect to a bunker using a stored client key and bunker URL (session restore).
   *
   * Unlike fromBunkerUrl(), this does NOT send a `connect` RPC — the session
   * already exists on the remote signer. It sets up the relay subscription
   * and calls getPublicKey() to verify the channel is alive (and prime the cache).
   */
  static async reconnect(
    clientSecretKey: Uint8Array,
    bunkerUrl: string,
    params?: BunkerSignerParams,
    connectTimeout = 30_000,
  ): Promise<BunkerNIP44Signer> {
    const bp = await parseBunkerInput(bunkerUrl);
    if (!bp) {
      throw new Error(`Invalid bunker URL: ${bunkerUrl}`);
    }
    // fromBunker sets up the relay subscription without sending any RPC
    const inner = BunkerSigner.fromBunker(clientSecretKey, bp, params);
    // Use getPublicKey() to verify the channel is alive — it's a mandatory
    // NIP-46 method (unlike ping which some signers don't implement) and
    // primes the pubkey cache. Avoids connect() which sends a new secret
    // that remote signers like Primal reject.
    await Promise.race([
      inner.getPublicKey(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Bunker reconnection timed out')), connectTimeout),
      ),
    ]);
    return new BunkerNIP44Signer(inner, 'nostrconnect');
  }

  /**
   * Two-phase nostrconnect: sets up relay connections and subscription,
   * then returns a handle. Show the QR code, then call handle.waitForSigner().
   *
   * This avoids a race where the user scans before the subscription is live.
   */
  static async prepareNostrConnect(
    connectionURI: string,
    clientSecretKey: Uint8Array,
    params?: BunkerSignerParams,
    timeoutOrAbort?: number | AbortSignal,
  ): Promise<NostrConnectHandle> {
    const uri = new URL(connectionURI);
    const relays = uri.searchParams.getAll('relay');
    const secret = uri.searchParams.get('secret');
    const clientPubkey = getPublicKey(clientSecretKey);

    if (relays.length === 0) {
      throw new Error('No relays specified in nostrconnect URI');
    }

    const abort =
      typeof timeoutOrAbort === 'number'
        ? AbortSignal.timeout(timeoutOrAbort)
        : timeoutOrAbort;

    const ac = new AbortController();
    const effectiveAbort = abort ?? ac.signal;

    const pool = new SimplePool();

    // Connect to all relays before subscribing
    await Promise.all(relays.map((r) => pool.ensureRelay(r)));

    // Set up subscription immediately — it's live now
    let settled = false;
    const signerPromise = new Promise<string>((resolve, reject) => {
      if (effectiveAbort.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      const sub = pool.subscribe(
        relays,
        { kinds: [24133], '#p': [clientPubkey], limit: 0 },
        {
          onevent: async (event) => {
            try {
              const convKey = getConversationKey(clientSecretKey, event.pubkey);
              const decrypted = decrypt(event.content, convKey);
              const response = JSON.parse(decrypted);
              if (response.result === secret) {
                settled = true;
                sub.close();
                resolve(event.pubkey);
              }
            } catch {
              // Not our event or decryption failed — ignore
            }
          },
          onclose: () => {
            if (!settled) {
              reject(
                new Error(
                  'Subscription closed before connection was established',
                ),
              );
            }
          },
          abort: effectiveAbort,
        },
      );

      effectiveAbort.addEventListener(
        'abort',
        () => {
          if (!settled) {
            settled = true;
            sub.close();
            reject(new Error('Connection timed out'));
          }
        },
        { once: true },
      );
    });

    return {
      async waitForSigner(): Promise<BunkerNIP44Signer> {
        const signerPubkey = await signerPromise;
        const bp = { pubkey: signerPubkey, relays, secret: secret || '' };
        const inner = BunkerSigner.fromBunker(clientSecretKey, bp, {
          ...params,
          pool,
        });
        return new BunkerNIP44Signer(inner, 'nostrconnect');
      },
      abort(): void {
        ac.abort();
      },
    };
  }

  /**
   * Connect via a nostrconnect:// URI (QR code flow).
   *
   * Convenience wrapper around prepareNostrConnect() — connects to relays,
   * subscribes, and waits for the ack in one call. If you need to show a
   * QR code only after the subscription is live, use prepareNostrConnect()
   * instead.
   */
  static async fromNostrConnect(
    connectionURI: string,
    clientSecretKey: Uint8Array,
    params?: BunkerSignerParams,
    timeoutOrAbort?: number | AbortSignal,
  ): Promise<BunkerNIP44Signer> {
    const handle = await BunkerNIP44Signer.prepareNostrConnect(
      connectionURI,
      clientSecretKey,
      params,
      timeoutOrAbort,
    );
    return handle.waitForSigner();
  }

  async getPublicKey(): Promise<string> {
    // Remote signers may require user approval on their device,
    // so give generous timeouts for the user to respond.
    return Promise.race([
      this.inner.getPublicKey(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('get_public_key timed out after 20s')), 20_000),
      ),
    ]);
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return this.inner.signEvent(event);
  }

  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return this.inner.nip04Encrypt(pubkey, plaintext);
  }

  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return this.inner.nip04Decrypt(pubkey, ciphertext);
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return this.inner.nip44Encrypt(pubkey, plaintext);
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return this.inner.nip44Decrypt(pubkey, ciphertext);
  }

  getBunkerUrl(): string {
    return toBunkerURL(this.inner.bp);
  }

  async close(): Promise<void> {
    await this.inner.close();
  }
}
