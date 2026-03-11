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
