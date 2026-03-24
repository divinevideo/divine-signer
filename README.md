# @divinevideo/signer

A headless Nostr signer library that gives web apps five authentication paths through one interface. No UI, no framework lock-in — just a `NostrSigner` interface your app programs against while users pick how they want to sign.

> **Note:** This package was previously published as `divine-signer`. Use `@divinevideo/signer` for new installs.

## Auth methods

| Method | Class | How it works |
|--------|-------|-------------|
| **nsec paste** | `NsecSigner` | User pastes a secret key. Signs and encrypts locally via nostr-tools. Simple but security-sensitive. |
| **NIP-07 extension** | `ExtensionSigner` | Delegates to browser extensions (Alby, nos2x, Soapbox Signer). Keys never leave the extension. |
| **NIP-46 bunker** | `BunkerNIP44Signer` | Connects to a remote signer via `bunker://` URL over WebSocket relays. |
| **NIP-46 nostrconnect** | `BunkerNIP44Signer` | QR code flow — user scans with a mobile signer app (Amber, Primal, nsec.app). |
| **OAuth** | `OAuthSigner` | OAuth login (e.g. [diVine](https://divine.video)). Signs over HTTP with PKCE, token refresh, and rate-limit retry. |

All five implement `NostrSigner`:

```typescript
interface NostrSigner {
  type: SignerType;
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<VerifiedEvent>;
  nip04Encrypt(pubkey: string, plaintext: string): Promise<string>;
  nip04Decrypt(pubkey: string, ciphertext: string): Promise<string>;
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>;
}
```

Your app codes against this interface. The user's choice of auth method is invisible to the rest of your stack.

## Install

```bash
npm install @divinevideo/signer
```

Requires `nostr-tools ^2.23.0` and `@divinevideo/login ^1.1.0` as peer dependencies.

## Quick start

### Direct signer usage

```typescript
import { NsecSigner, ExtensionSigner, BunkerNIP44Signer } from '@divinevideo/signer';

// nsec
const signer = new NsecSigner('nsec1...');

// Browser extension
const signer = new ExtensionSigner();

// Bunker URL
const signer = await BunkerNIP44Signer.fromBunkerUrl('bunker://...');

// Then use it — same API regardless of method
const pubkey = await signer.getPublicKey();
const signed = await signer.signEvent({ kind: 1, content: 'hello', tags: [], created_at: now });
const encrypted = await signer.nip44Encrypt(recipientPubkey, 'secret');
```

### OAuth flow (diVine)

OAuth uses `DivineOAuth` from `@divinevideo/login` (re-exported here for convenience):

```typescript
import { DivineOAuth, OAuthSigner } from '@divinevideo/signer';
import type { DivineStorage } from '@divinevideo/signer';

const storage: DivineStorage = {
  get: (key) => localStorage.getItem(key),
  set: (key, value) => localStorage.setItem(key, value),
  remove: (key) => localStorage.removeItem(key),
};

const oauth = new DivineOAuth({
  clientId: 'my-app',
  redirectUri: `${window.location.origin}/auth/callback`,
  storage,
});

// Start the flow
const url = oauth.buildAuthorizeUrl();
window.location.href = url;

// Handle the callback
const params = new URLSearchParams(window.location.search);
const tokens = await oauth.exchangeCode(params.get('code')!, params.get('state')!);
const signer = new OAuthSigner(tokens.access_token, {
  refreshToken: tokens.refresh_token,
});
```

### Session persistence

Save and restore sessions across page reloads:

```typescript
import { createSessionStore, restoreSession } from '@divinevideo/signer';

// Create a store backed by localStorage (or any storage with getItem/setItem/removeItem)
const sessions = createSessionStore(localStorage, 'my_app');

// After login, save the session
sessions.save({ type: 'oauth', accessToken, refreshToken });
// or: sessions.save({ type: 'extension' });
// or: sessions.save({ type: 'bunker', bunkerUrl: '...' });
// or: sessions.save({ type: 'nsec', nsec: '...' });

// On page load, restore it
const stored = sessions.load();
if (stored) {
  const signer = await restoreSession(stored);
  // signer is ready to use
}
```

### Token refresh (OAuth)

The `OAuthSigner` handles token refresh automatically. Hook into it to persist new tokens:

```typescript
import { OAuthSigner } from '@divinevideo/signer';

if (signer instanceof OAuthSigner) {
  signer.onTokenRefresh = ({ accessToken, refreshToken }) => {
    sessions.save({ type: 'oauth', accessToken, refreshToken });
  };
}
```

## API reference

### Signers

- `NsecSigner(nsec: string)` — local signing from a secret key
- `ExtensionSigner()` — delegates to `window.nostr` (NIP-07)
- `BunkerNIP44Signer.fromBunkerUrl(input, params?, overrideType?, timeout?)` — connect via bunker URL
- `BunkerNIP44Signer.reconnect(clientSecretKey, bunkerUrl, params?, timeout?)` — restore a bunker session
- `BunkerNIP44Signer.fromNostrConnect(uri, clientSecretKey, params?, timeoutOrAbort?)` — QR code connect flow
- `OAuthSigner(token, options?)` — HTTP signing via OAuth API
- `OAuthError` — thrown on 401/403 (check `error.status`)

### OAuth (re-exported from @divinevideo/login)

- `DivineOAuth` — OAuth flow manager (PKCE, authorize URL, code exchange)
- `createDivineClient(config)` — factory for `DivineRpc` client
- `generatePkce()` — generate PKCE code verifier + challenge

### Session

- `createSessionStore(storage, prefix)` — returns `{ save, load, clear }`
- `restoreSession(stored)` — reconstructs a `NostrSigner` from a `StoredSession`

### Types

- `NostrSigner` — the signer interface all methods implement
- `SignerType` — `'nsec' | 'extension' | 'bunker' | 'nostrconnect' | 'oauth'`
- `StoredSession` — discriminated union of all persistable session shapes
- `DivineClientConfig` — config for `createDivineClient`
- `DivineStorage` — interface for OAuth state persistence
- `PkceChallenge` — PKCE code verifier + challenge pair
- `TokenResponse` — token exchange response
- `StoredCredentials` — persisted OAuth credentials
- `TokenRefreshResult` — `{ accessToken, refreshToken }`

## Example

- [`examples/vanilla/`](examples/vanilla/) — minimal single-page app wiring all five auth methods, no framework, no CSS, just the API.
- [privdm](https://github.com/dcadenas/privdm) — a full React app (NIP-17 encrypted DMs) using divine-signer in production.

## Size

~9KB minified / ~3.4KB gzipped (excluding the nostr-tools peer dependency).

## License

[MPL-2.0](LICENSE)
