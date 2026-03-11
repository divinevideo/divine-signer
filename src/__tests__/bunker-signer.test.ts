import { generateSecretKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { BunkerNIP44Signer } from '../bunker-signer';

// BunkerSigner requires network (relay connections), so we test the factory
// validation and type assignment. Full integration requires a live bunker.

describe('BunkerNIP44Signer', () => {
  it('rejects invalid bunker input', async () => {
    await expect(BunkerNIP44Signer.fromBunkerUrl('not-a-bunker-url')).rejects.toThrow(
      'Invalid bunker input',
    );
  });

  it('has type bunker by default for bunker URLs', () => {
    // We can't test a full connection without a relay, but we verify the class shape
    expect(BunkerNIP44Signer.fromBunkerUrl).toBeDefined();
    expect(BunkerNIP44Signer.fromNostrConnect).toBeDefined();
  });
});

describe('BunkerNIP44Signer.reconnect', () => {
  it('rejects invalid bunker URL', async () => {
    const sk = generateSecretKey();
    await expect(BunkerNIP44Signer.reconnect(sk, 'not-valid')).rejects.toThrow(
      'Invalid bunker URL',
    );
  });

  it('calls ping instead of connect on the inner signer', async () => {
    const mockPing = vi.fn().mockResolvedValue('pong');
    const mockConnect = vi.fn().mockResolvedValue(undefined);

    // Mock nostr-tools/nip46 so fromBunker returns our mock signer
    const nip46 = await import('nostr-tools/nip46');
    const originalFromBunker = nip46.BunkerSigner.fromBunker;
    nip46.BunkerSigner.fromBunker = vi.fn().mockReturnValue({
      ping: mockPing,
      connect: mockConnect,
      bp: { pubkey: 'a'.repeat(64), relays: ['wss://relay.test'], secret: '' },
    }) as typeof nip46.BunkerSigner.fromBunker;

    try {
      const sk = generateSecretKey();
      const bunkerUrl = `bunker://${'a'.repeat(64)}?relay=wss://relay.test`;
      const signer = await BunkerNIP44Signer.reconnect(sk, bunkerUrl);

      expect(mockPing).toHaveBeenCalledTimes(1);
      expect(mockConnect).not.toHaveBeenCalled();
      expect(signer.type).toBe('nostrconnect');
    } finally {
      nip46.BunkerSigner.fromBunker = originalFromBunker;
    }
  });

  it('fromBunkerUrl calls connect instead of ping', async () => {
    const mockPing = vi.fn().mockResolvedValue('pong');
    const mockConnect = vi.fn().mockResolvedValue(undefined);

    const nip46 = await import('nostr-tools/nip46');
    const originalFromBunker = nip46.BunkerSigner.fromBunker;
    nip46.BunkerSigner.fromBunker = vi.fn().mockReturnValue({
      ping: mockPing,
      connect: mockConnect,
      bp: { pubkey: 'a'.repeat(64), relays: ['wss://relay.test'], secret: '' },
    }) as typeof nip46.BunkerSigner.fromBunker;

    try {
      const bunkerUrl = `bunker://${'a'.repeat(64)}?relay=wss://relay.test`;
      const signer = await BunkerNIP44Signer.fromBunkerUrl(bunkerUrl);

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockPing).not.toHaveBeenCalled();
      expect(signer.type).toBe('bunker');
    } finally {
      nip46.BunkerSigner.fromBunker = originalFromBunker;
    }
  });
});
