import type { AuthenticatedClient, IncomingPayment, OutgoingPayment } from '@interledger/open-payments'
import { checkCompletion } from './completion'
import type { CompletionStatus, PaymentKind } from './types'

export interface PollArgs {
  client: AuthenticatedClient
  kind: PaymentKind
  /** Full resource URL, e.g. https://ilp.interledger-test.dev/alice/incoming-payments/<id> */
  resourceUrl: string
  /** Access token for this resource, from the grant that authorized reading it. */
  accessToken: string
  /** Milliseconds between polls. Default 2000. */
  intervalMs?: number
  /** Total time to keep polling before giving up. Default 60000. */
  timeoutMs?: number
}

export interface PollResult {
  status: CompletionStatus
  reason?: string
  payment: IncomingPayment | OutgoingPayment
  /** How many GET requests were made. */
  attempts: number
}

const TERMINAL: CompletionStatus[] = ['completed', 'failed', 'indeterminate']

/**
 * Polls a single Open Payments resource until it reaches a terminal
 * completion state, or until timeoutMs elapses.
 *
 * Open Payments has no client-facing webhook or push notification for
 * payment completion (checked against the resource-server, auth-server and
 * wallet-address-server OpenAPI specs bundled in @interledger/open-payments
 * @7.4.0 — none define one). Polling is the only option available to a
 * plain Open Payments client, which is why this bridge is a poller, not a
 * listener, on its first real slice.
 */
export async function pollUntilComplete(args: PollArgs): Promise<PollResult> {
  const intervalMs = args.intervalMs ?? 2000
  const timeoutMs = args.timeoutMs ?? 60_000
  const deadline = Date.now() + timeoutMs

  let attempts = 0

  while (true) {
    attempts += 1
    const payment =
      args.kind === 'incoming'
        ? await args.client.incomingPayment.get({ url: args.resourceUrl, accessToken: args.accessToken })
        : await args.client.outgoingPayment.get({ url: args.resourceUrl, accessToken: args.accessToken })

    const check =
      args.kind === 'incoming'
        ? checkCompletion('incoming', payment as IncomingPayment)
        : checkCompletion('outgoing', payment as OutgoingPayment)

    if (TERMINAL.includes(check.status)) {
      return { status: check.status, reason: check.reason, payment, attempts }
    }

    if (Date.now() + intervalMs > deadline) {
      return { status: 'pending', reason: `timed out after ${attempts} attempt(s) over ~${timeoutMs}ms`, payment, attempts }
    }

    await sleep(intervalMs)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
