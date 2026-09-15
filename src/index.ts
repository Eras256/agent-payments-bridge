import type { IncomingPayment, OutgoingPayment } from '@interledger/open-payments'
import { pollUntilComplete, type PollArgs } from './poll'
import type { AuditSink, PaymentAnchorEvent } from './types'

export * from './types'
export * from './completion'
export * from './poll'
export * from './client'

export interface AnchorPaymentCompletionArgs extends PollArgs {
  sink: AuditSink
}

export interface AnchorPaymentCompletionResult {
  /** True only when the payment reached 'completed' and the sink recorded it. */
  anchored: boolean
  status: string
  reason?: string
  attempts: number
}

/**
 * The one real thing this package does end to end: poll an Open Payments
 * resource until it completes (or definitively doesn't), and — only on
 * genuine completion — hand a normalized event to the caller's own audit
 * sink. Failed and indeterminate outcomes are reported but never anchored:
 * an audit trail should never record a payment as complete on a guess.
 */
export async function anchorPaymentCompletion(
  args: AnchorPaymentCompletionArgs,
): Promise<AnchorPaymentCompletionResult> {
  const result = await pollUntilComplete(args)

  if (result.status !== 'completed') {
    return { anchored: false, status: result.status, reason: result.reason, attempts: result.attempts }
  }

  const event = toAnchorEvent(args.kind, result.payment)
  await args.sink.record(event)

  return { anchored: true, status: 'completed', attempts: result.attempts }
}

function toAnchorEvent(kind: 'incoming' | 'outgoing', payment: IncomingPayment | OutgoingPayment): PaymentAnchorEvent {
  const amount = kind === 'incoming' ? (payment as IncomingPayment).receivedAmount : (payment as OutgoingPayment).sentAmount

  return {
    kind,
    paymentId: payment.id,
    walletAddress: payment.walletAddress,
    amount: { value: amount.value, assetCode: amount.assetCode, assetScale: amount.assetScale },
    observedAt: new Date().toISOString(),
    raw: payment,
  }
}
