/**
 * Runnable example against the real Interledger test network
 * (wallet.interledger-test.dev) — not a mock. Requires your own test
 * wallet account and Developer Keys (see README.md).
 *
 * Usage:
 *   OP_WALLET_ADDRESS_URL=https://ilp.interledger-test.dev/yourname \
 *   OP_KEY_ID=... \
 *   OP_PRIVATE_KEY_PATH=./private.key \
 *   OP_INCOMING_PAYMENT_URL=https://ilp.interledger-test.dev/yourname/incoming-payments/<id> \
 *   OP_ACCESS_TOKEN=... \
 *   node dist/examples/anchor-to-audit-trail.js
 */
import { createBridgeClient } from '../src/client'
import { anchorPaymentCompletion } from '../src/index'
import type { AuditSink, PaymentAnchorEvent } from '../src/types'

// Stand-in audit sink — a real consumer (this project, or Nirium) implements
// this against its own audit trail instead of console.log.
class ConsoleAuditSink implements AuditSink {
  async record(event: PaymentAnchorEvent): Promise<void> {
    console.log('[audit] payment anchored:', JSON.stringify(event, null, 2))
  }
}

async function main() {
  const walletAddressUrl = requireEnv('OP_WALLET_ADDRESS_URL')
  const keyId = requireEnv('OP_KEY_ID')
  const privateKey = requireEnv('OP_PRIVATE_KEY_PATH')
  const resourceUrl = requireEnv('OP_INCOMING_PAYMENT_URL')
  const accessToken = requireEnv('OP_ACCESS_TOKEN')

  const client = await createBridgeClient({ walletAddressUrl, keyId, privateKey })

  const result = await anchorPaymentCompletion({
    client,
    kind: 'incoming',
    resourceUrl,
    accessToken,
    sink: new ConsoleAuditSink(),
    intervalMs: 2000,
    timeoutMs: 60_000,
  })

  console.log(result)
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}`)
  return value
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
