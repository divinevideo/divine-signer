import { ExtensionSigner } from '../extension-signer';

function mockWindowNostr(opts?: { skipNip04?: boolean; skipNip44?: boolean }) {
  const mock = {
    getPublicKey: vi.fn().mockResolvedValue('deadbeef'),
    signEvent: vi.fn().mockResolvedValue({ id: '1', sig: 'abc', pubkey: 'deadbeef', kind: 1, content: '', tags: [], created_at: 0 }),
    nip04: opts?.skipNip04
      ? undefined
      : {
          encrypt: vi.fn().mockResolvedValue('nip04-encrypted'),
          decrypt: vi.fn().mockResolvedValue('nip04-decrypted'),
        },
    nip44: opts?.skipNip44
      ? undefined
      : {
          encrypt: vi.fn().mockResolvedValue('nip44-encrypted'),
          decrypt: vi.fn().mockResolvedValue('nip44-decrypted'),
        },
  };
  Object.defineProperty(window, 'nostr', { value: mock, writable: true, configurable: true });
  return mock;
}

afterEach(() => {
  Object.defineProperty(window, 'nostr', { value: undefined, writable: true, configurable: true });
});

describe('ExtensionSigner', () => {
  it('throws when window.nostr is missing', () => {
    expect(() => new ExtensionSigner()).toThrow('No NIP-07 extension found');
  });

  it('has type extension', () => {
    mockWindowNostr();
    const signer = new ExtensionSigner();
    expect(signer.type).toBe('extension');
  });

  it('delegates getPublicKey to window.nostr', async () => {
    const mock = mockWindowNostr();
    const signer = new ExtensionSigner();
    const pubkey = await signer.getPublicKey();
    expect(pubkey).toBe('deadbeef');
    expect(mock.getPublicKey).toHaveBeenCalled();
  });

  it('delegates signEvent to window.nostr', async () => {
    const mock = mockWindowNostr();
    const signer = new ExtensionSigner();
    const template = { kind: 1, content: 'hi', created_at: 0, tags: [] };
    await signer.signEvent(template);
    expect(mock.signEvent).toHaveBeenCalledWith(template);
  });

  it('delegates nip04Encrypt to window.nostr.nip04', async () => {
    const mock = mockWindowNostr();
    const signer = new ExtensionSigner();
    const result = await signer.nip04Encrypt('pub123', 'hello');
    expect(result).toBe('nip04-encrypted');
    expect(mock.nip04!.encrypt).toHaveBeenCalledWith('pub123', 'hello');
  });

  it('delegates nip04Decrypt to window.nostr.nip04', async () => {
    const mock = mockWindowNostr();
    const signer = new ExtensionSigner();
    const result = await signer.nip04Decrypt('pub123', 'ciphertext');
    expect(result).toBe('nip04-decrypted');
    expect(mock.nip04!.decrypt).toHaveBeenCalledWith('pub123', 'ciphertext');
  });

  it('throws when nip04 is not supported', async () => {
    mockWindowNostr({ skipNip04: true });
    const signer = new ExtensionSigner();
    await expect(signer.nip04Encrypt('pub', 'text')).rejects.toThrow('does not support NIP-04');
    await expect(signer.nip04Decrypt('pub', 'text')).rejects.toThrow('does not support NIP-04');
  });

  it('delegates nip44Encrypt to window.nostr.nip44', async () => {
    const mock = mockWindowNostr();
    const signer = new ExtensionSigner();
    const result = await signer.nip44Encrypt('pub123', 'hello');
    expect(result).toBe('nip44-encrypted');
    expect(mock.nip44!.encrypt).toHaveBeenCalledWith('pub123', 'hello');
  });

  it('delegates nip44Decrypt to window.nostr.nip44', async () => {
    const mock = mockWindowNostr();
    const signer = new ExtensionSigner();
    const result = await signer.nip44Decrypt('pub123', 'ciphertext');
    expect(result).toBe('nip44-decrypted');
    expect(mock.nip44!.decrypt).toHaveBeenCalledWith('pub123', 'ciphertext');
  });

  it('throws when nip44 is not supported', async () => {
    mockWindowNostr({ skipNip44: true });
    const signer = new ExtensionSigner();
    await expect(signer.nip44Encrypt('pub', 'text')).rejects.toThrow('does not support NIP-44');
    await expect(signer.nip44Decrypt('pub', 'text')).rejects.toThrow('does not support NIP-44');
  });
});
