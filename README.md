# divine-signer

A headless Nostr signer library that gives web apps five authentication paths through one interface. No UI, no framework lock-in — just a `NostrSigner` interface your app programs against while users pick how they want to sign.

## Auth methods

| Method | Class | How it works |
|--------|-------|-------------|
| **nsec paste** | `NsecSigner` | User pastes a secret key. Signs and encrypts locally via nostr-tools. Simple but security-sensitive. |
| **NIP-07 extension** | `ExtensionSigner` | Delegates to browser extensions (Alby, nos2x, Soapbox Signer). Keys never leave the extension. |
| **NIP-46 bunker** | `BunkerNIP44Signer` | Connects to a remote signer via `bunker://` URL over WebSocket relays. |
| **NIP-46 nostrconnect** | `BunkerNIP44Signer` | QR code flow — user scans with a mobile signer app (Amber, Primal, nsec.app). |
| **diVine OAuth** | `KeycastHttpSigner` | Email/password login via [diVine](https://divine.video). Signs over HTTP with PKCE, token refresh, and rate-limit retry. |

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
npm install divine-signer
```

Or via CDN (no bundler needed):

```html
<script type="module">
  import { ExtensionSigner, buildOAuthUrl } from "https://esm.sh/divine-signer";
</script>
```

Requires `nostr-tools ^2.23.0` as a peer dependency.

## Quick start

### Direct signer usage

```typescript
import { NsecSigner, ExtensionSigner, BunkerNIP44Signer } from 'divine-signer';

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

OAuth requires two steps: redirect out, then handle the callback.

First, define your storage adapter (tells the library where to persist PKCE state):

```typescript
import type { OAuthStorage, OAuthConfig } from 'divine-signer';

const oauthStorage: OAuthStorage = {
  savePkceState: (s) => localStorage.setItem('my_oauth', JSON.stringify(s)),
  loadPkceState: () => { try { return JSON.parse(localStorage.getItem('my_oauth')!); } catch { return null; } },
  clearPkceState: () => localStorage.removeItem('my_oauth'),
  saveAuthorizationHandle: (h) => localStorage.setItem('my_auth_handle', h),
  loadAuthorizationHandle: () => localStorage.getItem('my_auth_handle'),
  clearAuthorizationHandle: () => localStorage.removeItem('my_auth_handle'),
};

const oauthConfig: OAuthConfig = {
  clientId: 'my-app',
  redirectUri: `${window.location.origin}/auth/callback`,
  storage: oauthStorage,
};
```

Start the flow (login page):

```typescript
import { buildOAuthUrl } from 'divine-signer';

const url = await buildOAuthUrl(oauthConfig);
window.location.href = url; // redirect to diVine
```

Handle the callback (`/auth/callback` route):

```typescript
import { exchangeCode } from 'divine-signer';

const params = new URLSearchParams(window.location.search);
const { signer, accessToken, refreshToken } = await exchangeCode(
  params.get('code')!,
  params.get('state')!,
  oauthConfig,
);
// signer is a KeycastHttpSigner — use it like any other NostrSigner
```

### Session persistence

Save and restore sessions across page reloads:

```typescript
import { createSessionStore, restoreSession } from 'divine-signer';

// Create a store backed by localStorage (or any storage with getItem/setItem/removeItem)
const sessions = createSessionStore(localStorage, 'my_app');

// After login, save the session
sessions.save({ type: 'keycast', accessToken, refreshToken });
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

### Token refresh (Keycast)

The `KeycastHttpSigner` handles token refresh automatically. Hook into it to persist new tokens:

```typescript
import { KeycastHttpSigner } from 'divine-signer';

if (signer instanceof KeycastHttpSigner) {
  signer.onTokenRefresh = ({ accessToken, refreshToken }) => {
    sessions.save({ type: 'keycast', accessToken, refreshToken });
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
- `KeycastHttpSigner(token, options?)` — HTTP signing via Keycast API
- `KeycastAuthError` — thrown on 401/403 (check `error.status`)

### OAuth

- `buildOAuthUrl(config, options?)` — returns authorize URL string (caller navigates)
- `exchangeCode(code, state, config)` — exchanges auth code for `OAuthResult { signer, accessToken, refreshToken? }`

### Session

- `createSessionStore(storage, prefix)` — returns `{ save, load, clear }`
- `restoreSession(stored)` — reconstructs a `NostrSigner` from a `StoredSession`

### Types

- `NostrSigner` — the signer interface all methods implement
- `SignerType` — `'nsec' | 'extension' | 'bunker' | 'nostrconnect' | 'keycast'`
- `StoredSession` — discriminated union of all persistable session shapes
- `OAuthStorage` — interface for PKCE state persistence
- `OAuthConfig` — `{ clientId, redirectUri, apiUrl?, scope?, storage, fetchImpl? }`
- `TokenRefreshResult` — `{ accessToken, refreshToken }`

## Example

- [`examples/vanilla/`](examples/vanilla/) — minimal single-page app wiring all five auth methods, no framework, no CSS, just the API.
- [privdm](https://github.com/dcadenas/privdm) — a full React app (NIP-17 encrypted DMs) using divine-signer in production.

## Size

~9KB minified / ~3.4KB gzipped (excluding the nostr-tools peer dependency).

## License

[MPL-2.0](LICENSE)
