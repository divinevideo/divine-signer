import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';

export type SignerType = 'nsec' | 'extension' | 'bunker' | 'nostrconnect' | 'keycast';

export interface NostrSigner {
  type: SignerType;
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  nip04Encrypt(pubkey: string, plaintext: string): Promise<string>;
  nip04Decrypt(pubkey: string, ciphertext: string): Promise<string>;
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>;
}

