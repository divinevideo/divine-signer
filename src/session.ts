import { nip19 } from 'nostr-tools';
import type { NostrSigner } from './types';
import { KeycastHttpSigner } from './keycast-http-signer';
import { ExtensionSigner } from './extension-signer';
import { BunkerNIP44Signer } from './bunker-signer';
import { NsecSigner } from './nsec-signer';

export type StoredSession =
  | { type: 'keycast'; accessToken: string; refreshToken?: string }
  | { type: 'bunker'; bunkerUrl: string }
  | { type: 'nostrconnect'; clientNsec: string; bunkerUrl: string }
  | { type: 'extension' }
  | { type: 'nsec'; nsec: string };

export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionStore {
  save(session: StoredSession): void;
  load(): StoredSession | null;
  clear(): void;
}

export function createSessionStore(storage: SessionStorage, prefix: string): SessionStore {
  const key = `${prefix}_session`;

  return {
    save(session: StoredSession): void {
      storage.setItem(key, JSON.stringify(session));
    },

    load(): StoredSession | null {
      const json = storage.getItem(key);
      if (!json) return null;
      try {
        const parsed: unknown = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object') return null;
        const obj = parsed as Record<string, unknown>;

        switch (obj.type) {
          case 'keycast':
            if (typeof obj.accessToken === 'string') {
              return {
                type: 'keycast',
                accessToken: obj.accessToken,
                ...(typeof obj.refreshToken === 'string' ? { refreshToken: obj.refreshToken } : {}),
              };
            }
            return null;
          case 'bunker':
            if (typeof obj.bunkerUrl === 'string') {
              return { type: 'bunker', bunkerUrl: obj.bunkerUrl };
            }
            return null;
          case 'nostrconnect':
            if (typeof obj.clientNsec === 'string' && typeof obj.bunkerUrl === 'string') {
              return { type: 'nostrconnect', clientNsec: obj.clientNsec, bunkerUrl: obj.bunkerUrl };
            }
            return null;
          case 'extension':
            return { type: 'extension' };
          case 'nsec':
            if (typeof obj.nsec === 'string') {
              return { type: 'nsec', nsec: obj.nsec };
            }
            return null;
          default:
            return null;
        }
      } catch {
        return null;
      }
    },

    clear(): void {
      storage.removeItem(key);
    },
  };
}

export async function restoreSession(session: StoredSession): Promise<NostrSigner> {
  switch (session.type) {
    case 'keycast':
      return new KeycastHttpSigner(session.accessToken, {
        refreshToken: session.refreshToken,
      });
    case 'extension':
      return new ExtensionSigner();
    case 'bunker':
      return BunkerNIP44Signer.fromBunkerUrl(session.bunkerUrl);
    case 'nostrconnect': {
      const { type, data } = nip19.decode(session.clientNsec);
      if (type !== 'nsec') throw new Error('Invalid client nsec');
      return BunkerNIP44Signer.reconnect(data, session.bunkerUrl);
    }
    case 'nsec':
      return new NsecSigner(session.nsec);
  }
}
