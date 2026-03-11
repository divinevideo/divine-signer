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

  /** Reconnect to a bunker using a stored client key and bunker URL (session restore). */
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
    const inner = BunkerSigner.fromBunker(clientSecretKey, bp, params);
    await Promise.race([
      inner.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Bunker connection timed out')), connectTimeout),
      ),
    ]);
    return new BunkerNIP44Signer(inner, 'nostrconnect');
  }

  /**
   * Connect via a nostrconnect:// URI (QR code flow).
   *
   * Implements the connect handshake manually instead of using
   * BunkerSigner.fromURI, which sends a `switch_relays` RPC that
   * signers like Primal don't understand (causing a parse error and
   * potentially disrupting the session). After the handshake we create
   * the signer via BunkerSigner.fromBunker which skips switch_relays.
   */
  static async fromNostrConnect(
    connectionURI: string,
    clientSecretKey: Uint8Array,
    params?: BunkerSignerParams,
    timeoutOrAbort?: number | AbortSignal,
  ): Promise<BunkerNIP44Signer> {
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

    const pool = new SimplePool();

    // Wait for the remote signer's connect ack (response containing our secret).
    const signerPubkey = await new Promise<string>((resolve, reject) => {
      if (abort?.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      let settled = false;

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
          abort,
        },
      );

      abort?.addEventListener(
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

    // Create signer via fromBunker — sets up subscription without
    // sending switch_relays, reusing the pool's relay connections.
    const bp = { pubkey: signerPubkey, relays, secret: secret || '' };
    const inner = BunkerSigner.fromBunker(clientSecretKey, bp, {
      ...params,
      pool,
    });
    return new BunkerNIP44Signer(inner, 'nostrconnect');
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
