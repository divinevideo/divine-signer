export {
  DivineOAuth,
  createDivineClient,
  generatePkce,
} from '@divinevideo/login';

export type {
  DivineClientConfig,
  DivineStorage,
  PkceChallenge,
  TokenResponse,
  StoredCredentials,
} from '@divinevideo/login';

// OAuthResult stays here since it references NostrSigner
import type { NostrSigner } from './types';

export interface OAuthResult {
  signer: NostrSigner;
  accessToken: string;
  refreshToken?: string;
}
