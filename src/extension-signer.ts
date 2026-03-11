import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';
import type { NostrSigner } from './types';

interface WindowNostrCrypto {
  encrypt(pubkey: string, plaintext: string): Promise<string>;
  decrypt(pubkey: string, ciphertext: string): Promise<string>;
}

interface WindowNostr {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  nip04?: WindowNostrCrypto;
  nip44?: WindowNostrCrypto;
}

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

export class ExtensionSigner implements NostrSigner {
  readonly type = 'extension' as const;
  private readonly nostr: WindowNostr;

  constructor() {
    if (!window.nostr) {
      throw new Error('No NIP-07 extension found (window.nostr is undefined)');
    }
    this.nostr = window.nostr;
  }

  async getPublicKey(): Promise<string> {
    return this.nostr.getPublicKey();
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return this.nostr.signEvent(event);
  }

  async nip04Encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (!this.nostr.nip04) {
      throw new Error('Extension does not support NIP-04 encryption');
    }
    return this.nostr.nip04.encrypt(pubkey, plaintext);
  }

  async nip04Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (!this.nostr.nip04) {
      throw new Error('Extension does not support NIP-04 decryption');
    }
    return this.nostr.nip04.decrypt(pubkey, ciphertext);
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    if (!this.nostr.nip44) {
      throw new Error('Extension does not support NIP-44 encryption');
    }
    return this.nostr.nip44.encrypt(pubkey, plaintext);
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    if (!this.nostr.nip44) {
      throw new Error('Extension does not support NIP-44 decryption');
    }
    return this.nostr.nip44.decrypt(pubkey, ciphertext);
  }
}
