# Divine Signer

A headless Nostr signer library that gives web apps five authentication paths through one interface. Published as [`@divinevideo/signer`](https://www.npmjs.com/package/@divinevideo/signer). No UI, no framework lock-in — just a `NostrSigner` interface your app programs against while users pick how they want to sign.

> **Note:** This package was previously published as `divine-signer`. Use `@divinevideo/signer` for new installs.

## Features

- **Five auth methods, one interface.** nsec paste, NIP-07 extension, NIP-46 bunker, NIP-46 nostrconnect (QR), and OAuth all implement the same `NostrSigner`.
- **Signing and encryption.** Every signer exposes `getPublicKey`, `signEvent`, and both NIP-04 and NIP-44 encrypt/decrypt.
- **Session persistence.** Save a login to any storage with `getItem`/`setItem`/`removeItem` and restore the signer on the next page load.
- **Automatic OAuth token refresh.** `OAuthSigner` refreshes expired access tokens and hands you the new pair to persist.
- **Embed bridge.** First-party Divine apps running inside a trusted `divine.video` iframe can reuse the host's signer over `postMessage` instead of asking users to sign in twice.
- **Small and dependency-light.** Ships as ESM with `nostr-tools` and `@divinevideo/login` as peer dependencies.

### Auth methods

| Method | Class | How it works |
|--------|-------|-------------|
| **nsec paste** | `NsecSigner` | User pastes a secret key. Signs and encrypts locally via nostr-tools. Simple but security-sensitive. |
| **NIP-07 extension** | `ExtensionSigner` | Delegates to browser extensions (Alby, nos2x, Soapbox Signer). Keys never leave the extension. |
| **NIP-46 bunker** | `BunkerNIP44Signer` | Connects to a remote signer via `bunker://` URL over WebSocket relays. |
| **NIP-46 nostrconnect** | `BunkerNIP44Signer` | QR code flow — user scans with a mobile signer app (Amber, Primal, nsec.app). |
| **OAuth** | `OAuthSigner` | OAuth login (e.g. [Divine](https://divine.video)). Signs over HTTP with token refresh and 401/403 handling. |

## Architecture

Every signer implements one interface:

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

Your app codes against this interface. The user's choice of auth method is invisible to the rest of your stack. Under the hood each signer wraps a different backend:

- **`NsecSigner`** holds the secret key and signs/encrypts locally with `nostr-tools/pure`, `nip04`, and `nip44`.
- **`ExtensionSigner`** proxies to `window.nostr` (NIP-07) and surfaces clear errors when an extension is absent or lacks NIP-04/NIP-44 support.
- **`BunkerNIP44Signer`** wraps `nostr-tools`' NIP-46 `BunkerSigner`, adding connect/reconnect timeouts and a two-phase nostrconnect flow that only completes once the relay subscription is live (avoiding a scan-before-ready race).
- **`OAuthSigner`** signs over HTTP through `DivineRpc` from `@divinevideo/login`, verifying every returned event and refreshing tokens on a 401.

**Platform fit.** Divine's login stack is OAuth-first via `@divinevideo/login`, and Divine Signer re-exports that client so apps get a single dependency for the full picture: OAuth for Divine accounts, plus the four other Nostr-native paths for users who bring their own keys. The embed bridge lets first-party apps embedded in the Divine host (for example the Flutter web shell) share one signed-in session across iframes.

## Getting started

```bash
npm install @divinevideo/signer
```

Requires `nostr-tools ^2.23.0` and `@divinevideo/login ^1.1.0` as peer dependencies.

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

### nostrconnect (QR code)

For the QR flow, prepare the connection first so the relay subscription is live before you show the code:

```typescript
import { BunkerNIP44Signer } from '@divinevideo/signer';
import { generateSecretKey } from 'nostr-tools/pure';

const clientKey = generateSecretKey();
const handle = await BunkerNIP44Signer.prepareNostrConnect(nostrconnectUri, clientKey);
// render the QR code now, then:
const signer = await handle.waitForSigner();
```

### OAuth flow (Divine)

OAuth uses `createDivineClient` from `@divinevideo/login` (re-exported here for convenience):

```typescript
import { OAuthSigner, createDivineClient } from '@divinevideo/signer';

const clientId = 'my-app';
const serverUrl = 'https://login.divine.video';
const divine = createDivineClient({
  serverUrl,
  clientId,
  redirectUri: `${window.location.origin}/auth/callback`,
  storage: localStorage,
});

// Start the flow
const { url } = await divine.oauth.getAuthorizationUrl();
window.location.href = url;

// Handle the callback
const params = new URLSearchParams(window.location.search);
const tokens = await divine.oauth.exchangeCode(params.get('code')!);
if (!tokens.access_token) throw new Error('OAuth response did not include an access token');

const signer = new OAuthSigner(tokens.access_token, {
  refreshToken: tokens.refresh_token,
  clientId,
  apiUrl: serverUrl,
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
// or: sessions.save({ type: 'nostrconnect', clientNsec: '...', bunkerUrl: '...' });
// or: sessions.save({ type: 'nsec', nsec: '...' });

// On page load, restore it
const stored = sessions.load();
if (stored) {
  const signer = await restoreSession(stored);
  // signer is ready to use
}
```

### Token refresh (OAuth)

The `OAuthSigner` refreshes access tokens automatically when it has a refresh token. Hook into it to persist new tokens:

```typescript
import { OAuthSigner } from '@divinevideo/signer';

if (signer instanceof OAuthSigner) {
  signer.onTokenRefresh = ({ accessToken, refreshToken }) => {
    sessions.save({ type: 'oauth', accessToken, refreshToken });
  };
}
```

### Embedded Divine apps

First-party Divine apps embedded in a trusted `divine.video` host can install a NIP-07 shim that proxies `ExtensionSigner` calls to the parent frame. Call it once during app startup, before constructing an `ExtensionSigner`:

```typescript
import { ExtensionSigner, installDivineEmbedBridge } from '@divinevideo/signer';

installDivineEmbedBridge();

const signer = new ExtensionSigner();
const pubkey = await signer.getPublicKey();
const signed = await signer.signEvent({ kind: 1, content: 'hello', tags: [], created_at: now });
const encrypted = await signer.nip44Encrypt(recipientPubkey, 'secret');
```

The bridge only installs for framed pages whose `document.referrer` host matches the Divine allowlist. The parent host must answer `divine:nostr.request` messages for `getPublicKey`, `signEvent`, `getRelays`, `nip04.encrypt`, `nip04.decrypt`, `nip44.encrypt`, and `nip44.decrypt`.

## Configuration

The library takes no environment variables — configuration is passed to the constructors and factories at call time.

### `OAuthSigner`

`new OAuthSigner(token, options?)` accepts:

| Option | Default | Purpose |
|--------|---------|---------|
| `refreshToken` | `undefined` | Enables automatic refresh on 401. Without it, expired tokens throw `OAuthError`. |
| `clientId` | `'privdm'` | OAuth client id used on refresh requests. |
| `apiUrl` | `https://login.divine.video` | Base URL for the Nostr signing and token endpoints. |
| `fetchImpl` | `globalThis.fetch` | Inject a custom `fetch` (useful for tests). |

### Embed bridge

`installDivineEmbedBridge(options?)` accepts `allowedHosts`, `allowedSuffixes`, and `requestTimeoutMs`. The defaults trust `divine.video`, `app.divine.video`, `localhost`, and any `*.divine.video` or `*.divine-mobile.pages.dev` host, with a 60s request timeout. Override the allowlists to embed under a different trusted origin.

## API reference

### Signers

- `NsecSigner(nsec: string)` — local signing from a secret key
- `ExtensionSigner()` — delegates to `window.nostr` (NIP-07)
- `BunkerNIP44Signer.fromBunkerUrl(input, params?, overrideType?, connectTimeout?)` — connect via bunker URL or NIP-05 identifier
- `BunkerNIP44Signer.reconnect(clientSecretKey, bunkerUrl, params?, connectTimeout?)` — restore a bunker session without re-sending `connect`
- `BunkerNIP44Signer.prepareNostrConnect(uri, clientSecretKey, params?, timeoutOrAbort?)` — two-phase QR flow; returns a `NostrConnectHandle`
- `BunkerNIP44Signer.fromNostrConnect(uri, clientSecretKey, params?, timeoutOrAbort?)` — one-call QR flow
- Instance helpers: `getBunkerUrl()` returns the `bunker://` URL; `close()` tears down relay connections
- `OAuthSigner(token, options?)` — HTTP signing via OAuth API
- `OAuthError` — thrown on 401/403 (check `error.status`)

### OAuth (re-exported from @divinevideo/login)

- `DivineOAuth` — OAuth flow manager (PKCE, authorize URL, code exchange)
- `createDivineClient(config)` — factory for the Divine RPC client
- `generatePkce()` — generate PKCE code verifier + challenge

### Session

- `createSessionStore(storage, prefix)` — returns `{ save, load, clear }`
- `restoreSession(stored)` — reconstructs a `NostrSigner` from a `StoredSession`

### Embed bridge

- `installDivineEmbedBridge(options?)` — installs the framed-app `window.nostr` bridge when the parent origin is trusted; returns `true` when installed
- `isDivineEmbedded()` — whether the bridge installed in the current window
- `getDivineParentOrigin()` — the trusted parent origin after install, otherwise `null`
- `DEFAULT_ALLOWED_PARENT_HOSTS` / `DEFAULT_ALLOWED_PARENT_SUFFIXES` — default parent host allowlists

### Types

- `NostrSigner` — the signer interface all methods implement
- `SignerType` — `'nsec' | 'extension' | 'bunker' | 'nostrconnect' | 'oauth'`
- `NostrConnectHandle` — `{ waitForSigner, abort }` returned by `prepareNostrConnect`
- `StoredSession` / `SessionStore` / `SessionStorage` — session persistence shapes
- `TokenRefreshResult` — `{ accessToken, refreshToken }`
- `EmbedBridgeOptions` / `EmbedBridgeRequest` / `EmbedBridgeResponse` — embed bridge message contract
- `DivineClientConfig`, `DivineStorage`, `OAuthResult`, `PkceChallenge`, `TokenResponse`, `StoredCredentials` — OAuth types

## Development

```bash
npm install        # install dependencies
npm run build      # bundle the library (esbuild) and emit type declarations (tsc)
npm run typecheck  # type-check without emitting
npm test           # run the Vitest suite
npm run test:watch # run tests in watch mode
```

The build bundles `src/index.ts` to ESM with `nostr-tools` and `@divinevideo/login` left external. `npm publish` runs the build automatically via `prepublishOnly`. If you change the public API or example flows, update the README and the example together.

## Examples

- [`examples/vanilla/`](examples/vanilla/) — minimal single-page app wiring all five auth methods, no framework, no CSS, just the API.
- [privdm](https://github.com/dcadenas/privdm) — a full React app (NIP-17 encrypted DMs) using this signer in production.

## License

[MPL-2.0](LICENSE)

---

Part of [Divine](https://divine.video) — your playground for human creativity · [Brand guidelines](https://github.com/divinevideo/brand-guidelines)
