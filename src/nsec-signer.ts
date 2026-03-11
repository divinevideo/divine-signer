import { nip19 } from 'nostr-tools';
import {
  getPublicKey,
  finalizeEvent,
  type EventTemplate,
  type VerifiedEvent,
} from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';
import * as nip44 from 'nostr-tools/nip44';
import type { NostrSigner } from './types';

export class NsecSigner implements NostrSigner {
  readonly type = 'nsec' as const;
  private readonly secretKey: Uint8Array;

  constructor(nsec: string) {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') {
      throw new Error(`Expected nsec, got ${decoded.type}`);
    }
    this.secretKey = decoded.data;
  }

  async getPublicKey(): Promise<string> {
    return getPublicKey(this.secretKey);
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return finalizeEvent(event, this.secretKey);
  }

  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return nip04.encrypt(this.secretKey, pubkey, plaintext);
  }

  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return nip04.decrypt(this.secretKey, pubkey, ciphertext);
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    const convKey = nip44.v2.utils.getConversationKey(this.secretKey, pubkey);
    return nip44.v2.encrypt(plaintext, convKey);
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    const convKey = nip44.v2.utils.getConversationKey(this.secretKey, pubkey);
    return nip44.v2.decrypt(ciphertext, convKey);
  }
}
