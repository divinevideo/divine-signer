import {
  NsecSigner,
  ExtensionSigner,
  BunkerNIP44Signer,
  OAuthSigner,
  createDivineClient,
  createSessionStore,
  restoreSession,
  installDivineEmbedBridge,
} from '@divinevideo/signer';
import type { NostrSigner } from '@divinevideo/signer';

installDivineEmbedBridge();

const oauthClientId = 'divine-signer-example';
const oauthServerUrl = 'https://login.divine.video';
const divine = createDivineClient({
  serverUrl: oauthServerUrl,
  clientId: oauthClientId,
  redirectUri: `${window.location.origin}${window.location.pathname}`,
  storage: localStorage,
});

const sessions = createSessionStore(localStorage, 'example');

// ── State ───────────────────────────────────────────────────

let signer: NostrSigner | null = null;
const app = document.getElementById('app')!;

// ── Render ──────────────────────────────────────────────────

function renderLogin() {
  app.innerHTML = `
    <h2>divine-signer example</h2>

    <fieldset>
      <legend>nsec</legend>
      <input id="nsec-input" placeholder="nsec1..." size="64" />
      <button id="nsec-btn">Login</button>
    </fieldset>

    <fieldset>
      <legend>NIP-07 extension</legend>
      <button id="ext-btn">Login with extension</button>
    </fieldset>

    <fieldset>
      <legend>Bunker URL</legend>
      <input id="bunker-input" placeholder="bunker://..." size="64" />
      <button id="bunker-btn">Connect</button>
    </fieldset>

    <fieldset>
      <legend>diVine OAuth</legend>
      <button id="oauth-btn">Login with diVine</button>
    </fieldset>

    <pre id="status"></pre>
  `;

  document.getElementById('nsec-btn')!.onclick = async () => {
    const nsec = (document.getElementById('nsec-input') as HTMLInputElement).value.trim();
    if (!nsec) return;
    const s = new NsecSigner(nsec);
    sessions.save({ type: 'nsec', nsec });
    onLogin(s);
  };

  document.getElementById('ext-btn')!.onclick = async () => {
    const s = new ExtensionSigner();
    try {
      await s.getPublicKey(); // verify extension is available
      sessions.save({ type: 'extension' });
      onLogin(s);
    } catch (e) {
      showStatus(`Extension error: ${e}`);
    }
  };

  document.getElementById('bunker-btn')!.onclick = async () => {
    const url = (document.getElementById('bunker-input') as HTMLInputElement).value.trim();
    if (!url) return;
    showStatus('Connecting to bunker...');
    try {
      const s = await BunkerNIP44Signer.fromBunkerUrl(url);
      sessions.save({ type: 'bunker', bunkerUrl: url });
      onLogin(s);
    } catch (e) {
      showStatus(`Bunker error: ${e}`);
    }
  };

  document.getElementById('oauth-btn')!.onclick = async () => {
    const { url } = await divine.oauth.getAuthorizationUrl();
    window.location.href = url;
  };
}

function renderLoggedIn(pubkey: string) {
  app.innerHTML = `
    <h2>Logged in</h2>
    <p>Method: <strong>${signer!.type}</strong></p>
    <p>Pubkey: <code>${pubkey}</code></p>

    <fieldset>
      <legend>Sign a kind:1 note</legend>
      <input id="note-input" placeholder="Hello nostr" size="64" />
      <button id="sign-btn">Sign</button>
    </fieldset>

    <button id="logout-btn">Logout</button>

    <pre id="status"></pre>
  `;

  document.getElementById('sign-btn')!.onclick = async () => {
    const content = (document.getElementById('note-input') as HTMLInputElement).value;
    const event = await signer!.signEvent({
      kind: 1,
      content,
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    });
    showStatus(JSON.stringify(event, null, 2));
  };

  document.getElementById('logout-btn')!.onclick = () => {
    signer = null;
    sessions.clear();
    renderLogin();
  };
}

// ── Helpers ─────────────────────────────────────────────────

function showStatus(msg: string) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

async function onLogin(s: NostrSigner) {
  signer = s;

  if (s instanceof OAuthSigner) {
    s.onTokenRefresh = ({ accessToken, refreshToken }) => {
      sessions.save({ type: 'oauth', accessToken, refreshToken });
    };
  }

  const pubkey = await s.getPublicKey();
  renderLoggedIn(pubkey);
}

// ── Boot ────────────────────────────────────────────────────

async function boot() {
  // Handle OAuth callback
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');

  if (code && state) {
    try {
      const tokens = await divine.oauth.exchangeCode(code);
      if (!tokens.access_token) {
        throw new Error('OAuth response did not include an access token');
      }
      const s = new OAuthSigner(tokens.access_token, {
        refreshToken: tokens.refresh_token,
        clientId: oauthClientId,
        apiUrl: oauthServerUrl,
      });
      sessions.save({
        type: 'oauth',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });
      window.history.replaceState({}, '', window.location.pathname);
      onLogin(s);
      return;
    } catch (e) {
      window.history.replaceState({}, '', window.location.pathname);
      renderLogin();
      showStatus(`OAuth error: ${e}`);
      return;
    }
  }

  // Restore previous session
  const stored = sessions.load();
  if (stored) {
    try {
      const s = await restoreSession(stored);
      onLogin(s);
      return;
    } catch {
      sessions.clear();
    }
  }

  renderLogin();
}

boot();
