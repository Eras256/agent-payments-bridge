import type { IncomingPayment, OutgoingPayment } from '@interledger/open-payments'
import type { CompletionCheck } from './types'

/**
 * IncomingPayment.completed is a direct boolean in the Open Payments
 * resource-server spec ("Describes whether the incoming payment has
 * completed receiving fund."). No derivation needed.
 */
export function checkIncomingPaymentCompletion(payment: IncomingPayment): CompletionCheck {
  return { status: payment.completed ? 'completed' : 'pending' }
}

/**
 * OutgoingPayment has no `completed` field. The spec instead exposes
 * `failed` (boolean) and three amounts: debitAmount, receiveAmount,
 * sentAmount. Completion is derived as: not failed, and the full
 * receiveAmount has been sent.
 *
 * Verified against the resource-server OpenAPI schema shipped inside
 * @interledger/open-payments@7.4.0 (dist/openapi/specs/resource-server.yaml)
 * on 2026-09-14 — not assumed from prose docs.
 */
export function checkOutgoingPaymentCompletion(payment: OutgoingPayment): CompletionCheck {
  if (payment.failed) {
    return { status: 'failed', reason: 'outgoing payment has failed=true' }
  }

  const { sentAmount, receiveAmount } = payment

  if (sentAmount.assetCode !== receiveAmount.assetCode || sentAmount.assetScale !== receiveAmount.assetScale) {
    return {
      status: 'indeterminate',
      reason:
        `sentAmount is denominated in ${sentAmount.assetCode}/${sentAmount.assetScale} but ` +
        `receiveAmount is denominated in ${receiveAmount.assetCode}/${receiveAmount.assetScale}. ` +
        'The Open Payments spec does not document a conversion between these for completion purposes; ' +
        'this bridge will not guess an FX rate. Compare them yourself if you have one you trust.',
    }
  }

  const sent = BigInt(sentAmount.value)
  const target = BigInt(receiveAmount.value)

  return { status: sent >= target ? 'completed' : 'pending' }
}

export function checkCompletion(
  kind: 'incoming',
  payment: IncomingPayment,
): CompletionCheck
export function checkCompletion(
  kind: 'outgoing',
  payment: OutgoingPayment,
): CompletionCheck
export function checkCompletion(
  kind: 'incoming' | 'outgoing',
  payment: IncomingPayment | OutgoingPayment,
): CompletionCheck {
  return kind === 'incoming'
    ? checkIncomingPaymentCompletion(payment as IncomingPayment)
    : checkOutgoingPaymentCompletion(payment as OutgoingPayment)
}
