import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { NsecSigner } from '../nsec-signer';

function makeNsec(): { nsec: string; secretKey: Uint8Array; pubkey: string } {
  const secretKey = generateSecretKey();
  const nsec = nip19.nsecEncode(secretKey);
  const pubkey = getPublicKey(secretKey);
  return { nsec, secretKey, pubkey };
}

describe('NsecSigner', () => {
  it('rejects non-nsec input', () => {
    const { pubkey } = makeNsec();
    const npub = nip19.npubEncode(pubkey);
    expect(() => new NsecSigner(npub)).toThrow('Expected nsec');
  });

  it('returns correct public key', async () => {
    const { nsec, pubkey } = makeNsec();
    const signer = new NsecSigner(nsec);
    expect(await signer.getPublicKey()).toBe(pubkey);
  });

  it('has type nsec', () => {
    const { nsec } = makeNsec();
    const signer = new NsecSigner(nsec);
    expect(signer.type).toBe('nsec');
  });

  it('signs events with correct pubkey and signature', async () => {
    const { nsec, pubkey } = makeNsec();
    const signer = new NsecSigner(nsec);

    const event = await signer.signEvent({
      kind: 1,
      content: 'hello',
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
    });

    expect(event.pubkey).toBe(pubkey);
    expect(event.sig).toBeDefined();
    expect(event.id).toBeDefined();
  });

  it('encrypts and decrypts with nip04', async () => {
    const alice = makeNsec();
    const bob = makeNsec();
    const aliceSigner = new NsecSigner(alice.nsec);
    const bobSigner = new NsecSigner(bob.nsec);

    const plaintext = 'secret message nip04';
    const ciphertext = await aliceSigner.nip04Encrypt(bob.pubkey, plaintext);
    const decrypted = await bobSigner.nip04Decrypt(alice.pubkey, ciphertext);

    expect(decrypted).toBe(plaintext);
  });

  it('encrypts and decrypts with nip44', async () => {
    const alice = makeNsec();
    const bob = makeNsec();
    const aliceSigner = new NsecSigner(alice.nsec);
    const bobSigner = new NsecSigner(bob.nsec);

    const plaintext = 'secret message';
    const ciphertext = await aliceSigner.nip44Encrypt(bob.pubkey, plaintext);
    const decrypted = await bobSigner.nip44Decrypt(alice.pubkey, ciphertext);

    expect(decrypted).toBe(plaintext);
  });

  it('encrypt produces different ciphertext each time', async () => {
    const alice = makeNsec();
    const bob = makeNsec();
    const signer = new NsecSigner(alice.nsec);

    const ct1 = await signer.nip44Encrypt(bob.pubkey, 'test');
    const ct2 = await signer.nip44Encrypt(bob.pubkey, 'test');

    expect(ct1).not.toBe(ct2);
  });
});
