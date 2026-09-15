import { createAuthenticatedClient, type AuthenticatedClient } from '@interledger/open-payments'

export interface BridgeClientConfig {
  /** The wallet address the bridge identifies itself as (e.g. https://ilp.interledger-test.dev/yourname). */
  walletAddressUrl: string
  /** Private EdDSA-Ed25519 key, or a path to it, from the wallet's Developer Keys tab. */
  privateKey: string
  /** The key ID shown alongside the generated key. */
  keyId: string
}

/**
 * Thin wrapper around the official SDK's createAuthenticatedClient. Kept
 * separate so the rest of the bridge depends on an interface (AuthenticatedClient)
 * rather than on how it's constructed — swapping in a mock for tests doesn't
 * require touching poll.ts or index.ts.
 */
export async function createBridgeClient(config: BridgeClientConfig): Promise<AuthenticatedClient> {
  return createAuthenticatedClient({
    walletAddressUrl: config.walletAddressUrl,
    privateKey: config.privateKey,
    keyId: config.keyId,
  })
}
