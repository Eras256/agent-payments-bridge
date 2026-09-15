import type { IncomingPayment, OutgoingPayment } from '@interledger/open-payments'

export type PaymentKind = 'incoming' | 'outgoing'

/**
 * Outcome of checking a payment's completion state.
 *
 * 'indeterminate' exists because the Open Payments resource-server spec does
 * not guarantee that an outgoing payment's `sentAmount` and `receiveAmount`
 * share the same assetCode/assetScale, and does not document how to compare
 * them when they differ. Rather than guess, the bridge surfaces this case
 * explicitly so a caller can decide (e.g. via an FX rate it trusts).
 */
export type CompletionStatus = 'completed' | 'pending' | 'failed' | 'indeterminate'

export interface CompletionCheck {
  status: CompletionStatus
  /** Present when status is 'failed' or 'indeterminate'. */
  reason?: string
}

/**
 * Normalized event the bridge hands to an AuditSink once a payment is
 * observed as completed. This is NOT a settlement receipt — Open Payments
 * exposes no completion timestamp for either payment type (only
 * `createdAt`/`expiresAt`), so `observedAt` is the bridge's own poll time,
 * not a wallet-attested moment of settlement. Consumers needing a trusted
 * settlement time must get it from elsewhere (e.g. their own ASE/webhook).
 */
export interface PaymentAnchorEvent {
  kind: PaymentKind
  paymentId: string
  walletAddress: string
  amount: {
    value: string
    assetCode: string
    assetScale: number
  }
  observedAt: string
  raw: IncomingPayment | OutgoingPayment
}

/**
 * Implemented once per consumer (e.g. Nirium's audit trail, this project's
 * own). The bridge never writes to a specific audit store itself — that
 * would couple generic Open Payments plumbing to one project's schema.
 */
export interface AuditSink {
  record(event: PaymentAnchorEvent): Promise<void>
}
