import { createSessionStore, restoreSession } from '../session';
import type { StoredSession, SessionStorage } from '../session';
import { KeycastHttpSigner } from '../keycast-http-signer';
import { ExtensionSigner } from '../extension-signer';
import { BunkerNIP44Signer } from '../bunker-signer';
import { NsecSigner } from '../nsec-signer';
import { generateSecretKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

vi.mock('../extension-signer');
vi.mock('../bunker-signer');

function createMemoryStorage(): SessionStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
}

describe('createSessionStore', () => {
  function makeStore() {
    const storage = createMemoryStorage();
    return createSessionStore(storage, 'test');
  }

  describe('save / load', () => {
    it('round-trips a keycast session', () => {
      const store = makeStore();
      const session: StoredSession = { type: 'keycast', accessToken: 'tok-123' };
      store.save(session);
      expect(store.load()).toEqual(session);
    });

    it('round-trips a bunker session', () => {
      const store = makeStore();
      const session: StoredSession = { type: 'bunker', bunkerUrl: 'bunker://abc' };
      store.save(session);
      expect(store.load()).toEqual(session);
    });

    it('round-trips a nostrconnect session', () => {
      const store = makeStore();
      const session: StoredSession = {
        type: 'nostrconnect',
        clientNsec: 'nsec1abc',
        bunkerUrl: 'bunker://pubkey?relay=wss://relay.test',
      };
      store.save(session);
      expect(store.load()).toEqual(session);
    });

    it('round-trips an extension session', () => {
      const store = makeStore();
      const session: StoredSession = { type: 'extension' };
      store.save(session);
      expect(store.load()).toEqual(session);
    });

    it('returns null when nothing is stored', () => {
      const store = makeStore();
      expect(store.load()).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const storage = createMemoryStorage();
      storage.setItem('test_session', 'not-json');
      const store = createSessionStore(storage, 'test');
      expect(store.load()).toBeNull();
    });

    it('round-trips an nsec session', () => {
      const store = makeStore();
      const session: StoredSession = { type: 'nsec', nsec: 'nsec1test' };
      store.save(session);
      expect(store.load()).toEqual(session);
    });

    it('returns null for unknown session type', () => {
      const storage = createMemoryStorage();
      storage.setItem('test_session', JSON.stringify({ type: 'magic', key: 'secret' }));
      const store = createSessionStore(storage, 'test');
      expect(store.load()).toBeNull();
    });

    it('returns null for nsec session missing nsec field', () => {
      const storage = createMemoryStorage();
      storage.setItem('test_session', JSON.stringify({ type: 'nsec' }));
      const store = createSessionStore(storage, 'test');
      expect(store.load()).toBeNull();
    });

    it('returns null for keycast session missing accessToken', () => {
      const storage = createMemoryStorage();
      storage.setItem('test_session', JSON.stringify({ type: 'keycast' }));
      const store = createSessionStore(storage, 'test');
      expect(store.load()).toBeNull();
    });

    it('returns null for bunker session missing bunkerUrl', () => {
      const storage = createMemoryStorage();
      storage.setItem('test_session', JSON.stringify({ type: 'bunker' }));
      const store = createSessionStore(storage, 'test');
      expect(store.load()).toBeNull();
    });

    it('returns null for nostrconnect session missing clientNsec', () => {
      const storage = createMemoryStorage();
      storage.setItem('test_session', JSON.stringify({ type: 'nostrconnect', bunkerUrl: 'bunker://abc' }));
      const store = createSessionStore(storage, 'test');
      expect(store.load()).toBeNull();
    });

    it('returns null for nostrconnect session missing bunkerUrl', () => {
      const storage = createMemoryStorage();
      storage.setItem('test_session', JSON.stringify({ type: 'nostrconnect', clientNsec: 'nsec1abc' }));
      const store = createSessionStore(storage, 'test');
      expect(store.load()).toBeNull();
    });

    it('returns null for non-object values', () => {
      const storage = createMemoryStorage();
      storage.setItem('test_session', '"just a string"');
      const store = createSessionStore(storage, 'test');
      expect(store.load()).toBeNull();
    });

    it('returns null for null value', () => {
      const storage = createMemoryStorage();
      storage.setItem('test_session', 'null');
      const store = createSessionStore(storage, 'test');
      expect(store.load()).toBeNull();
    });
  });

  describe('clear', () => {
    it('removes the stored session', () => {
      const store = makeStore();
      store.save({ type: 'extension' });
      store.clear();
      expect(store.load()).toBeNull();
    });
  });
});

describe('restoreSession', () => {
  it('creates KeycastHttpSigner for keycast session', async () => {
    const signer = await restoreSession({ type: 'keycast', accessToken: 'tok-123' });
    expect(signer).toBeInstanceOf(KeycastHttpSigner);
    expect(signer.type).toBe('keycast');
  });

  it('creates ExtensionSigner for extension session', async () => {
    const signer = await restoreSession({ type: 'extension' });
    expect(signer).toBeInstanceOf(ExtensionSigner);
  });

  it('calls BunkerNIP44Signer.fromBunkerUrl for bunker session', async () => {
    const mockSigner = { type: 'bunker' };
    vi.mocked(BunkerNIP44Signer.fromBunkerUrl).mockResolvedValue(mockSigner as unknown as BunkerNIP44Signer);

    const signer = await restoreSession({ type: 'bunker', bunkerUrl: 'bunker://abc' });
    expect(signer).toBe(mockSigner);
    expect(BunkerNIP44Signer.fromBunkerUrl).toHaveBeenCalledWith('bunker://abc');
  });

  it('propagates errors from signer construction', async () => {
    vi.mocked(BunkerNIP44Signer.fromBunkerUrl).mockRejectedValue(new Error('connection failed'));

    await expect(
      restoreSession({ type: 'bunker', bunkerUrl: 'bunker://bad' }),
    ).rejects.toThrow('connection failed');
  });

  it('calls BunkerNIP44Signer.reconnect for nostrconnect session', async () => {
    const mockSigner = { type: 'nostrconnect' };
    vi.mocked(BunkerNIP44Signer.reconnect).mockResolvedValue(mockSigner as unknown as BunkerNIP44Signer);

    const clientKey = generateSecretKey();
    const clientNsec = nip19.nsecEncode(clientKey);
    const bunkerUrl = 'bunker://remote-pubkey?relay=wss://relay.test';

    const signer = await restoreSession({ type: 'nostrconnect', clientNsec, bunkerUrl });
    expect(signer).toBe(mockSigner);
    expect(BunkerNIP44Signer.reconnect).toHaveBeenCalledWith(
      clientKey,
      bunkerUrl,
    );
  });

  it('creates NsecSigner for nsec session', async () => {
    const sk = generateSecretKey();
    const nsec = nip19.nsecEncode(sk);
    const signer = await restoreSession({ type: 'nsec', nsec });
    expect(signer).toBeInstanceOf(NsecSigner);
    expect(signer.type).toBe('nsec');
  });

  it('throws for invalid nsec in nostrconnect session', async () => {
    await expect(
      restoreSession({ type: 'nostrconnect', clientNsec: 'not-an-nsec', bunkerUrl: 'bunker://abc' }),
    ).rejects.toThrow();
  });
});
